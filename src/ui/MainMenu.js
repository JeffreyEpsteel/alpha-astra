import { GameState, SLOTS } from '../game/GameState.js';
import { CHARACTERS, DEFAULT_CHARACTER, portraitUrl } from '../game/Characters.js';
import { BOATS } from '../game/Boats.js';
import { rankTitle } from '../game/Progression.js';
import { MODES, MODE_IDS, DEFAULT_MODE, isMode, modeLabel } from '../game/GameMode.js';
import { icon, brandMark } from './icons.js';
import { Credits } from './Credits.js';
import {
	probeUniverse, normalizeUniverseUrl, defaultUniverseAddress, lastUniverseAddress, isDefaultUniverse, probeHealth, healthText, UPDATING_TEXT,
	UniverseSession, remember, recall, SERVER_KEY, NAME_KEY,
} from '../net/Universe.js';
import { isUniverseUrl } from '../net/Protocol.js';
import { crewCodeFromLocation, defaultServerUrl } from '../net/NetClient.js';

// The illustrated main menu, over the key art, in the HUD's glass look. Two steps: the mode, then the slot.
//
//   const menu = new MainMenu( { ui, app } );
//   const choice = await menu.show();    // { mode, slot, name, server, newGame, online }
//   app.startSession( choice );          // loads the slot in that mode, puts the player back, connects when online
//
//   menu.show( { mode, step: 'slots', back: true } )   // straight to a mode's slot list (the pause menu's Load); resolves null on Cancel / Esc
//
// Step 1 lists the modes (game/GameMode.js): Sandbox (free play), Campaign (the progression game) and Multiplayer
// (the campaign on a server). Click one, press 1 / 2 / 3 or the arrows and Enter. Step 2 lists that mode's four
// save slots (GameState.listSlots): an empty slot or the islander's name, portrait, rank, boat and play time (the
// purse too, except in the sandbox where nothing costs). Enter / Play plays the selected slot (an empty one starts
// fresh); New game clears an existing slot after a confirmation. Multiplayer adds the server field and plays as
// "Connect and play". "Change mode" goes back to step 1. The last mode used is remembered for next time.
// The pointer is released while the menu is up and every key is kept from the game (the controls sheet, F1, still
// works through its own link). The menu only lists and deletes stored saves: the root (App.startSession) loads
// the chosen slot, sets the name and the server and connects.
//
// Multiplayer has two ways in (a switch above the step, remembered): Universe and Island / crew. Universe asks for the
// server address (remembered), the captain name and Join: the menu probes the server (src/net/Universe.js: the name must
// belong to this browser's token), shows a readable error (server down, name taken, banned, full...) or resolves with
// { mode: 'multiplayer', slot: 0, name: captain, server: <ws url>, newGame: no stored game, online: true, universe: session }
// after attaching the UniverseSession to the app, so GameState reads and writes the captain's game on the server instead of
// a local slot. Choosing anything else detaches it again. Island / crew is the slot list with a server field, as before.
// Wave 15: the Multiplayer card always opens the Universe tab (a crew code or an island ?server= in the page address picks
// Island / crew instead) with the shared universe's address filled in (Universe.defaultUniverseAddress: wss on Fly.io, or a
// PC's own universe for a page that PC serves); the panel asks its /health at once and on every address change and shows
// "Online · 3 captains aboard", "Updating" (the server runs another commit of the game: Join waits) or "Offline" and why.
// The address stays editable for friends' servers; "default" puts the shared one back, "last used" the one typed before.

// The backdrop is the illustrated key art (public/ui/menu, from the Unreal game's T_HyptileMenu): Hyptile on the dock at
// the right, calm open sea on the left 42% where the card sits. A 2560 and a 1280 wide JPEG; the page picks by its
// physical width. A left-to-right scrim keeps the text readable over the sea and sky without hiding the character.
const ART = { wide: 'ui/menu/hyptile-menu-2560.jpg', narrow: 'ui/menu/hyptile-menu-1280.jpg', breakpoint: 1500 };

const CSS = /* css */`
.mm { position: absolute; inset: 0; z-index: 26; display: grid; place-items: center; padding: var(--tw-5); overflow: auto;
	background: #0c2a3c; opacity: 0;
	transition: opacity var(--tw-slow) var(--tw-ease); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); }
.mm.is-on { opacity: 1; }
.mm:not(.is-on) { pointer-events: none; }
.mm-art { position: fixed; inset: 0; z-index: -1; background: var(--mm-art) 72% center / cover no-repeat; transform: scale(1.02); }
.mm-art::after { content: ''; position: absolute; inset: 0;
	background: linear-gradient(90deg, rgba(4, 14, 24, 0.82) 0%, rgba(4, 14, 24, 0.62) 34%, rgba(4, 14, 24, 0.12) 62%, rgba(4, 14, 24, 0) 100%),
		linear-gradient(180deg, rgba(4, 14, 24, 0.28) 0%, rgba(4, 14, 24, 0) 28%, rgba(4, 14, 24, 0) 70%, rgba(4, 14, 24, 0.5) 100%); }
@media (min-width: 1100px) { .mm { place-items: center start; padding-left: clamp(24px, 6vw, 140px); } .mm .mm-card { width: min(calc(760 * var(--tw-u)), 50vw); } }
@media (max-width: 1099px) { .mm-art::after { background: linear-gradient(180deg, rgba(4, 14, 24, 0.7), rgba(4, 14, 24, 0.5) 50%, rgba(4, 14, 24, 0.78)); } }
.mm-card { position: relative; width: min(calc(760 * var(--tw-u)), 100%); max-height: calc(100vh - 2 * var(--tw-5)); display: flex; flex-direction: column;
	padding: var(--tw-5) var(--tw-6); border-radius: var(--tw-r-lg); transform: translateY(calc(8 * var(--tw-u))); transition: transform 700ms var(--tw-ease); }
.mm.is-on .mm-card { transform: none; }
.mm-head { display: flex; align-items: center; gap: var(--tw-4); margin-bottom: var(--tw-4); }
.mm-mark { width: calc(44 * var(--tw-u)); height: calc(44 * var(--tw-u)); flex: none; filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.45)); }
.mm-title { font-size: clamp(22px, 2.6vw, 34px); font-weight: 600; letter-spacing: 0.32em; line-height: 1.05; text-shadow: 0 2px 24px rgba(0, 0, 0, 0.5); }
.mm-tag { margin-top: var(--tw-1); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); letter-spacing: 0.04em; }
.mm-body { display: grid; grid-template-columns: 1.25fr 1fr; gap: var(--tw-5); min-height: 0; }
@media (max-width: 640px) { .mm-body { grid-template-columns: 1fr; } .mm-card { padding: var(--tw-4); } }
.mm h3 { margin: 0 0 var(--tw-2); font-size: var(--tw-fs-xs); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tw-ink-3); }
.mm-slots { display: flex; flex-direction: column; gap: var(--tw-2); overflow: auto; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2); }
.mm-slot { position: relative; display: grid; grid-template-columns: auto 1fr auto; gap: var(--tw-3); align-items: center; padding: var(--tw-2) var(--tw-3);
	border-radius: var(--tw-r-md); background: var(--tw-fill); box-shadow: inset 0 0 0 1px var(--tw-line); cursor: pointer; text-align: left;
	transition: background var(--tw-fast), box-shadow var(--tw-fast); outline: none; }
.mm-slot:hover { background: var(--tw-fill-2); }
.mm-slot.is-on { background: linear-gradient(180deg, rgba(var(--tw-aqua-rgb), 0.18), rgba(var(--tw-aqua-rgb), 0.06));
	box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.5), 0 0 18px -6px rgba(var(--tw-aqua-rgb), 0.55); }
.mm-slot:focus-visible { box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.8); }
.mm-face { width: calc(44 * var(--tw-u)); height: calc(44 * var(--tw-u)); border-radius: 50%; object-fit: cover; background: var(--tw-fill-2);
	box-shadow: inset 0 0 0 1px var(--tw-line-2); }
.mm-face.is-empty { display: grid; place-items: center; color: var(--tw-ink-4); border: 1px dashed var(--tw-line-2); box-shadow: none; }
.mm-face.is-empty .tw-ico { width: calc(18 * var(--tw-u)); height: calc(18 * var(--tw-u)); }
.mm-slot-text { min-width: 0; }
.mm-slot-name { font-weight: 600; font-size: var(--tw-fs-md); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-slot.is-empty .mm-slot-name { color: var(--tw-ink-3); font-weight: 500; }
.mm-slot-meta { margin-top: 2px; color: var(--tw-ink-2); font-size: var(--tw-fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-slot-meta b { color: var(--tw-sun); font-family: var(--tw-mono); font-weight: 600; }
.mm-slot-when { margin-top: 1px; color: var(--tw-ink-4); font-size: var(--tw-fs-xs); }
.mm-slot-no { font-family: var(--tw-mono); font-size: var(--tw-fs-xs); color: var(--tw-ink-4); align-self: start; }
.mm-del { position: absolute; right: var(--tw-2); bottom: var(--tw-2); padding: 2px calc(6 * var(--tw-u)); border-radius: 999px; font-size: var(--tw-fs-xs);
	color: var(--tw-ink-4); background: transparent; opacity: 0; transition: opacity var(--tw-fast), color var(--tw-fast); }
.mm-slot:hover .mm-del, .mm-slot.is-on .mm-del, .mm-del:focus-visible { opacity: 1; }
.mm-del:hover { color: var(--tw-coral); background: var(--tw-fill-2); }
.mm-del.is-arm { color: var(--tw-coral); background: rgba(255, 122, 133, 0.14); opacity: 1; }
.mm-side { display: flex; flex-direction: column; gap: var(--tw-3); }
.mm-field { display: flex; flex-direction: column; gap: var(--tw-1); }
.mm-field span { font-size: var(--tw-fs-xs); color: var(--tw-ink-3); letter-spacing: 0.04em; }
.mm-field input { width: 100%; height: calc(34 * var(--tw-u)); padding: 0 var(--tw-3); border: 0; border-radius: calc(9 * var(--tw-u)); background: var(--tw-fill-2);
	box-shadow: inset 0 0 0 1px var(--tw-line-2); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); outline: none; -webkit-user-select: text; user-select: text; }
.mm-field input:focus { box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.7); }
.mm-field input.is-mono { font-family: var(--tw-mono); font-size: var(--tw-fs-sm); }
.mm-actions { display: flex; flex-direction: column; gap: var(--tw-2); margin-top: var(--tw-2); }
.mm-actions .tw-btn .tw-ico { width: calc(16 * var(--tw-u)); height: calc(16 * var(--tw-u)); }
.mm-actions .tw-btn.is-arm { color: #2a0a0e; background: linear-gradient(180deg, #ff9aa2, #ff7a85); box-shadow: 0 0 0 1px rgba(255, 122, 133, 0.6); }
.mm-row { display: flex; gap: var(--tw-2); }
.mm-row .tw-btn { flex: 1; }
.mm-links { display: flex; flex-wrap: wrap; gap: var(--tw-2) var(--tw-4); margin-top: auto; padding-top: var(--tw-3); font-size: var(--tw-fs-sm); color: var(--tw-ink-3); }
.mm-links button { color: var(--tw-ink-2); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--tw-line-2); }
.mm-links button:hover { color: var(--tw-ink); }
.mm-links kbd { margin-left: var(--tw-1); padding: 0 4px; border-radius: 4px; background: var(--tw-fill-2); font: 500 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-3); }
.mm-note { min-height: 1.4em; font-size: var(--tw-fs-sm); color: var(--tw-ink-3); }
.mm-note.is-warn { color: var(--tw-coral); }
.mm-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--tw-3); }
@media (max-width: 640px) { .mm-modes { grid-template-columns: 1fr; } }
.mm-mode { display: flex; flex-direction: column; gap: var(--tw-2); padding: var(--tw-4); border-radius: var(--tw-r-md); background: var(--tw-fill); box-shadow: inset 0 0 0 1px var(--tw-line);
	text-align: left; cursor: pointer; outline: none; transition: background var(--tw-fast), box-shadow var(--tw-fast), transform var(--tw-fast); }
.mm-mode:hover { background: var(--tw-fill-2); }
.mm-mode:active { transform: translateY(1px); }
.mm-mode.is-on { background: linear-gradient(180deg, rgba(var(--tw-aqua-rgb), 0.18), rgba(var(--tw-aqua-rgb), 0.06));
	box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.5), 0 0 18px -6px rgba(var(--tw-aqua-rgb), 0.55); }
.mm-mode:focus-visible { box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.8); }
.mm-mode-ico { display: grid; place-items: center; width: calc(34 * var(--tw-u)); height: calc(34 * var(--tw-u)); border-radius: 50%; color: var(--tw-aqua); background: rgba(var(--tw-aqua-rgb), 0.12); }
.mm-mode-ico .tw-ico { width: calc(18 * var(--tw-u)); height: calc(18 * var(--tw-u)); }
.mm-mode-name { font-size: var(--tw-fs-lg); font-weight: 600; letter-spacing: 0.04em; }
.mm-mode-tag { color: var(--tw-ink-2); font-size: var(--tw-fs-sm); }
.mm-mode-list { margin: var(--tw-1) 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); line-height: 1.35; }
.mm-mode-list li { position: relative; padding-left: 12px; }
.mm-mode-list li::before { content: ''; position: absolute; left: 0; top: 0.55em; width: 5px; height: 5px; border-radius: 50%; background: rgba(var(--tw-aqua-rgb), 0.55); }
.mm-mode-saves { margin-top: auto; padding-top: var(--tw-2); color: var(--tw-ink-4); font-size: var(--tw-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; }
.mm-modepill { display: inline-flex; align-items: center; gap: var(--tw-2); align-self: flex-start; margin-bottom: var(--tw-3); padding: 3px var(--tw-3) 3px var(--tw-2); border-radius: 999px;
	background: rgba(var(--tw-aqua-rgb), 0.12); box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.35); color: var(--tw-ink); font-size: var(--tw-fs-sm); font-weight: 600; cursor: pointer; }
.mm-modepill:hover { background: rgba(var(--tw-aqua-rgb), 0.2); }
.mm-modepill .tw-ico { width: calc(14 * var(--tw-u)); height: calc(14 * var(--tw-u)); color: var(--tw-aqua); }
.mm-modepill small { color: var(--tw-ink-3); font-size: var(--tw-fs-xs); font-weight: 500; }
.mm-seg { display: inline-flex; align-self: flex-start; gap: 2px; margin: 0 0 var(--tw-3) var(--tw-2); padding: 2px; border-radius: 999px; background: var(--tw-fill);
	box-shadow: inset 0 0 0 1px var(--tw-line); vertical-align: top; }
.mm-seg button { padding: 3px var(--tw-3); border-radius: 999px; font-size: var(--tw-fs-sm); font-weight: 600; color: var(--tw-ink-3); cursor: pointer; }
.mm-seg button.is-on { color: var(--tw-ink); background: rgba(var(--tw-aqua-rgb), 0.2); box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.45); }
.mm-uni { display: flex; flex-direction: column; gap: var(--tw-2); padding: var(--tw-3) var(--tw-4); border-radius: var(--tw-r-md); background: var(--tw-fill);
	box-shadow: inset 0 0 0 1px var(--tw-line); color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.45; }
.mm-uni b { color: var(--tw-ink); }
.mm-uni-status { font-family: var(--tw-mono); font-size: var(--tw-fs-xs); color: var(--tw-ink-3); }
.mm-uni-status.is-ok { color: var(--tw-aqua); }
.mm-uni-status.is-warn { color: var(--tw-coral); }
.mm-field-head { display: flex; align-items: baseline; gap: var(--tw-2); }
.mm-field-head > span { flex: 1; }
.mm-field-head button { font-size: var(--tw-fs-xs); color: var(--tw-ink-3); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--tw-line-2); cursor: pointer; }
.mm-field-head button:hover { color: var(--tw-ink); }
.tw-root.is-photo .mm { display: none; }
`;

const MODE_KEY = 'alpha-astra.mode'; // the last mode played (localStorage)
const NET_KEY = 'alpha-astra.netway'; // 'universe' | 'crew': the multiplayer way chosen last

export class MainMenu {

	constructor( { ui, app, slots = SLOTS } ) {

		this.ui = ui;
		this.app = app;
		this.slots = slots;
		this.selected = 0; // the highlighted slot
		this.mode = DEFAULT_MODE; // the mode highlighted / browsed
		this.step = 'modes'; // 'modes' | 'slots'
		this.cancelable = false;
		this.open = false;
		this.view = null; // 'main' while shown
		this._promise = null;
		this._resolve = null;
		this._arm = null; // { kind: 'new' | 'del', slot, t } a pending confirmation
		this._rows = [];
		this.netWay = recall( NET_KEY, 'universe' ) === 'crew' ? 'crew' : 'universe';
		this._joining = 0; // a universe probe in flight (its number: a newer one wins)
		if ( ! document.getElementById( 'mm-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'mm-style';
			style.textContent = CSS;
			document.head.append( style );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'mm tw-interactive';
		el.hidden = true;
		el.style.setProperty( '--mm-art', `url("${ base() }${ artPath() }")` );
		for ( const t of [ 'pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'touchstart' ] ) el.addEventListener( t, ( e ) => e.stopPropagation(), { passive: true } );
		el.addEventListener( 'contextmenu', ( e ) => { e.stopPropagation(); if ( ! isTyping( e.target ) ) e.preventDefault(); } );
		this._onKey = ( e ) => this._key( e );
		( ui && ui.root ? ui.root : document.body ).append( el );

	}

	// the game's state (the menu reads slots from its storage)
	get state() {

		return this.app && this.app.game ? this.app.game.state : null;

	}

	get storage() {

		const st = this.state;
		// (while a universe game is attached, the state's storage is the server's: the slots live in the local one)
		if ( st && st.storage && st.storage.universe ) return st.storage.universe.local;
		return st ? st.storage : ( typeof localStorage !== 'undefined' ? localStorage : null );

	}

	// ---- main menu

	// Shows the menu; resolves with the player's choice { mode, slot, name, server, newGame, online }, or null when
	// it was cancelled (opts.back) or hidden. opts: { mode, step: 'modes' | 'slots', back }
	show( opts = {} ) {

		if ( this._promise && this.view === 'main' ) return this._promise;
		if ( this.open ) this._finish( null );
		this.view = 'main';
		this.cancelable = !! opts.back;
		this.mode = isMode( opts.mode ) ? opts.mode : this._startMode();
		this.step = opts.step === 'slots' && isMode( opts.mode ) ? 'slots' : 'modes';
		// a server or a crew code in the page address picks the multiplayer way
		const ps = this.app && this.app.pendingServer;
		if ( ps ) this.netWay = isUniverseUrl( ps ) ? 'universe' : 'crew';
		else if ( crewCodeFromLocation() ) this.netWay = 'crew';
		else if ( this.app && this.app.universe ) this.netWay = 'universe';
		this._promise = new Promise( ( resolve ) => { this._resolve = resolve; } );
		this._open();
		this._renderMain();
		return this._promise;

	}

	hide() {

		this._finish( null );

	}

	// re-list the slots (after a save elsewhere)
	refresh() {

		if ( this.open && this.view === 'main' && this.step === 'slots' ) this._renderSlots();

	}

	// the mode to highlight first: the server in the address says multiplayer, else the last one played
	_startMode() {

		if ( this.app && this.app.pendingServer ) return 'multiplayer';
		const requested = this.app?.qs?.get?.( 'mode' );
		if ( isMode( requested ) ) return requested;
		try {

			const m = localStorage.getItem( MODE_KEY );
			if ( isMode( m ) ) return m;

		} catch ( e ) { /* no storage */ }

		return DEFAULT_MODE;

	}

	_rememberMode() {

		try {

			localStorage.setItem( MODE_KEY, this.mode );

		} catch ( e ) { /* no storage */ }

	}

	// ---- rendering

	_open() {

		const el = this.el;
		this.open = true;
		el.hidden = false;
		void el.offsetWidth;
		el.classList.add( 'is-on' );
		if ( this.ui && this.ui.root ) this.ui.root.classList.add( 'is-menu' );
		try {

			if ( document.pointerLockElement ) document.exitPointerLock?.();

		} catch ( e ) { /* no pointer lock */ }

		window.addEventListener( 'keydown', this._onKey, { capture: true } );
		window.addEventListener( 'keyup', this._onKey, { capture: true } );

	}

	_finish( result ) {

		if ( ! this.open ) return;
		this.open = false;
		this._arm = null;
		this._joining = 0;
		if ( result ) this._rememberMode();
		// another way to play: the captain's server game lets go of the state (it saves first)
		if ( result && ! result.universe && this.app && this.app.universe && this.app.universe.detach ) this.app.universe.detach();
		const el = this.el;
		el.classList.remove( 'is-on' );
		if ( this.ui && this.ui.root ) this.ui.root.classList.remove( 'is-menu' );
		window.removeEventListener( 'keydown', this._onKey, { capture: true } );
		window.removeEventListener( 'keyup', this._onKey, { capture: true } );
		const a = document.activeElement;
		if ( a && el.contains( a ) ) a.blur();
		const view = this.view;
		setTimeout( () => { if ( ! this.open ) { el.hidden = true; if ( this.view === view ) el.innerHTML = ''; } }, 450 );
		const resolve = this._resolve;
		this._resolve = null;
		this._promise = null;
		this.view = null;
		if ( resolve ) resolve( result );

	}

	_renderMain() {

		this._arm = null;
		if ( this.step === 'slots' ) this._renderSlotStep();
		else this._renderModes();

	}

	_header() {

		return `<header class="mm-head">
			${ brandMark( 'mm-mark' ) }
			<div>
				<div class="mm-title">ALPHA ASTRA</div>
				<div class="mm-tag">A small island, a rod, a boat and the whole bay to fish.</div>
			</div>
		</header>`;

	}

	// the links under both steps: controls, the guide, and a way out when the menu came from the game
	_bindLinks() {

		const q = ( s ) => this.el.querySelector( s );
		const controls = q( '[data-controls]' );
		if ( controls ) controls.addEventListener( 'click', () => { if ( this.ui && this.ui.toggleHelp ) this.ui.toggleHelp( true ); } );
		const guide = q( '[data-guide]' );
		if ( guide ) {

			if ( this.ui && typeof this.ui.onReplayGuide === 'function' ) guide.addEventListener( 'click', () => {

				if ( this.step === 'slots' ) this._play( false );
				else this._pickMode( this.mode );
				try { this.ui.onReplayGuide(); } catch ( e ) { console.error( e ); }

			} );
			else guide.hidden = true;

		}

		const cancel = q( '[data-cancel]' );
		if ( cancel ) cancel.addEventListener( 'click', () => this._finish( null ) );
		// the credits panel over the menu (src/ui/Credits.js); _key lets it have the keyboard while it is up
		const credits = q( '[data-credits]' );
		if ( credits ) credits.addEventListener( 'click', () => {

			if ( ! this.credits ) this.credits = new Credits( { ui: this.ui } );
			this.credits.open( { returnFocus: credits } );

		} );

	}

	// step 1: the mode
	_renderModes() {

		const cards = MODE_IDS.map( ( id, i ) => {

			const m = MODES[ id ];
			const n = GameState.listSlots( this.storage, this.slots, id ).filter( ( r ) => r.exists ).length;
			return `<button type="button" class="mm-mode ${ id === this.mode ? 'is-on' : '' }" role="option" aria-selected="${ id === this.mode }" data-mode="${ id }">
				<span class="mm-mode-ico">${ icon( m.icon ) }</span>
				<span class="mm-mode-name">${ i + 1 } · ${ esc( m.name ) }</span>
				<span class="mm-mode-tag">${ esc( m.tagline ) }</span>
				<ul class="mm-mode-list">${ m.bullets.map( ( b ) => `<li>${ esc( b ) }</li>` ).join( '' ) }</ul>
				<span class="mm-mode-saves">${ n ? `${ n } save${ n > 1 ? 's' : '' }` : 'No saves yet' }</span>
			</button>`;

		} ).join( '' );
		this.el.innerHTML = `
			<div class="mm-art" aria-hidden="true"></div>
			<div class="mm-card tw-glass" role="dialog" aria-modal="true" aria-label="Alpha Astra">
				${ this._header() }
				<h3>How do you want to play?</h3>
				<div class="mm-modes" role="listbox" aria-label="Game mode">${ cards }</div>
				<div class="mm-links">
					<button type="button" data-controls>Controls<kbd>F1</kbd></button>
					<button type="button" data-guide>Replay the guide</button>
					<button type="button" data-credits>Credits</button>
					${ this.cancelable ? '<button type="button" data-cancel>Cancel<kbd>Esc</kbd></button>' : '' }
					<span>Saves stay in this browser · built on Tidewater (MIT)</span>
				</div>
			</div>`;
		this._cards = [ ...this.el.querySelectorAll( '.mm-mode' ) ];
		for ( const c of this._cards ) {

			c.addEventListener( 'click', () => this._pickMode( c.dataset.mode ) );
			c.addEventListener( 'mouseenter', () => this._highlightMode( c.dataset.mode ) );

		}

		this._bindLinks();
		const on = this._cards.find( ( c ) => c.dataset.mode === this.mode );
		if ( on ) on.focus( { preventScroll: true } );

	}

	_highlightMode( id ) {

		if ( ! isMode( id ) || id === this.mode ) return;
		this.mode = id;
		for ( const c of this._cards || [] ) {

			const on = c.dataset.mode === id;
			c.classList.toggle( 'is-on', on );
			c.setAttribute( 'aria-selected', String( on ) );
			if ( on && document.activeElement !== c ) c.focus( { preventScroll: true } );

		}

	}

	// a mode was chosen: on to its slots
	_pickMode( id ) {

		if ( ! isMode( id ) ) return;
		this.mode = id;
		this.step = 'slots';
		// Multiplayer opens on the universe (the shared one is the default way in) unless the page address names a crew / room
		if ( id === 'multiplayer' && ! this._pageWantsCrew() ) this.netWay = 'universe';
		this._renderMain();

	}

	_pageWantsCrew() {

		const ps = this.app && this.app.pendingServer;
		if ( ps ) return ! isUniverseUrl( ps );
		return !! crewCodeFromLocation();

	}

	// step 2: the slots of the mode, the name, the server
	_renderSlotStep() {

		if ( this.mode === 'multiplayer' && this.netWay === 'universe' ) return this._renderUniverseStep();
		const st = this.state, m = MODES[ this.mode ], online = this.mode === 'multiplayer';
		const list = this._list = GameState.listSlots( this.storage, this.slots, this.mode );
		// start on the slot played last (the latest save), else the one in use for this mode, else the first
		let best = st && st.mode === this.mode ? st.slot : 0, t = - 1;
		for ( const r of list ) if ( r.exists && r.savedAt > t ) { t = r.savedAt; best = r.slot; }
		this.selected = best;
		let server = this.app && typeof this.app.serverUrl === 'function' ? this.app.serverUrl() : '';
		if ( isUniverseUrl( server ) ) server = defaultServerUrl(); // (the universe has its own tab)
		const name = st && st.name ? st.name : ( list[ best ] && list[ best ].name ) || '';
		this.el.innerHTML = `
			<div class="mm-art" aria-hidden="true"></div>
			<div class="mm-card tw-glass" role="dialog" aria-modal="true" aria-label="Alpha Astra">
				${ this._header() }
				<div><button type="button" class="mm-modepill" data-modes aria-label="Change the game mode">${ icon( m.icon ) }<span>${ esc( m.name ) }</span><small>change</small></button>${ online ? this._segHTML() : '' }</div>
				<div class="mm-body">
					<section>
						<h3>${ esc( m.name ) } islanders</h3>
						<div class="mm-slots" role="listbox" aria-label="Save slots"></div>
					</section>
					<section class="mm-side">
						<label class="mm-field"><span>Your name on the island</span><input type="text" maxlength="24" autocomplete="off" spellcheck="false" data-name value="${ esc( name ) }" placeholder="Islander"></label>
						${ online ? `<label class="mm-field"><span>Server</span><input type="text" class="is-mono" autocomplete="off" spellcheck="false" data-server value="${ esc( server ) }" placeholder="ws://host:8765/island"></label>` : '' }
						<div class="mm-actions">
							<button type="button" class="tw-btn tw-btn-primary" data-play>${ icon( 'play' ) }<span>${ online ? 'Connect and play' : 'Play' }</span></button>
							<button type="button" class="tw-btn tw-btn-default" data-new>${ icon( 'refresh' ) }<span>New game</span></button>
							<div class="mm-note" data-note></div>
						</div>
						<div class="mm-links">
							<button type="button" data-controls>Controls<kbd>F1</kbd></button>
							<button type="button" data-guide>Replay the guide</button>
							<button type="button" data-credits>Credits</button>
							${ this.cancelable ? '<button type="button" data-cancel>Cancel<kbd>Esc</kbd></button>' : '' }
							<span>Saves stay in this browser</span>
						</div>
					</section>
				</div>
			</div>`;
		this._renderSlots();
		const q = ( s ) => this.el.querySelector( s );
		this.nameEl = q( '[data-name]' );
		this.serverEl = q( '[data-server]' );
		this.noteEl = q( '[data-note]' );
		this.newBtn = q( '[data-new]' );
		q( '[data-play]' ).addEventListener( 'click', () => this._play( false ) );
		this.newBtn.addEventListener( 'click', () => this._newGame() );
		q( '[data-modes]' ).addEventListener( 'click', () => this._toModes() );
		this._bindSeg();
		this._bindLinks();
		this._note();

	}

	// ---- multiplayer: the universe or an island / crew room

	_segHTML() {

		const w = this.netWay;
		return `<span class="mm-seg" role="tablist" aria-label="Multiplayer">
			<button type="button" role="tab" data-way="universe" class="${ w === 'universe' ? 'is-on' : '' }" aria-selected="${ w === 'universe' }">Universe</button>
			<button type="button" role="tab" data-way="crew" class="${ w === 'crew' ? 'is-on' : '' }" aria-selected="${ w === 'crew' }">Island / crew</button>
		</span>`;

	}

	_bindSeg() {

		for ( const b of this.el.querySelectorAll( '[data-way]' ) ) b.addEventListener( 'click', () => this._setWay( b.dataset.way ) );

	}

	_setWay( way ) {

		way = way === 'crew' ? 'crew' : 'universe';
		if ( way === this.netWay ) return;
		this.netWay = way;
		this._joining = 0;
		remember( NET_KEY, way );
		this._renderMain();

	}

	// the universe: a server keeps the captain's game; address, captain name, Join
	_renderUniverseStep() {

		const m = MODES[ this.mode ], st = this.state;
		this._list = null;
		this._rows = [];
		const ps = this.app && this.app.pendingServer;
		const current = this.app && this.app.universe;
		const def = defaultUniverseAddress();
		const address = ps && isUniverseUrl( ps ) ? ps : current && current.url ? current.url : def;
		const last = lastUniverseAddress();
		const name = recall( NAME_KEY, '' ) || ( st && st.name ) || '';
		const shared = isDefaultUniverse( normalizeUniverseUrl( address ) );
		this.el.innerHTML = `
			<div aria-hidden="true" class="mm-art"></div>
			<div class="mm-card tw-glass" role="dialog" aria-modal="true" aria-label="Alpha Astra">
				${ this._header() }
				<div><button type="button" class="mm-modepill" data-modes aria-label="Change the game mode">${ icon( m.icon ) }<span>${ esc( m.name ) }</span><small>change</small></button>${ this._segHTML() }</div>
				<div class="mm-body">
					<section>
						<h3>The universe</h3>
						<div class="mm-uni">
							<div>A <b>universe</b> is an island world that keeps running when nobody is on: destroyed docks stay broken until they respawn, boats stay where their captains left them, the market and the pirates carry on. Alpha Astra uses its own server. Run HOST_CODEX_MULTIPLAYER locally or enter an Alpha Astra host address.</div>
							<div>The server keeps your captain's game. Your name is yours on that server from the first join, tied to this browser (no password), so use the same browser to come back.</div>
							<div class="mm-uni-status" data-status>${ current && current.captain ? `Playing as ${ esc( current.captain ) } on ${ esc( current.url ) }` : 'Not joined' }</div>
						</div>
					</section>
					<section class="mm-side">
						<div class="mm-field">
							<div class="mm-field-head"><span>Server address</span><button type="button" data-last title="${ esc( last ) }" ${ last ? '' : 'hidden' }>last used</button><button type="button" data-default title="${ esc( def ) }" ${ shared || address === def ? 'hidden' : '' }>default</button></div>
							<input type="text" class="is-mono" autocomplete="off" spellcheck="false" aria-label="Server address" data-server value="${ esc( address ) }" placeholder="${ esc( def ) }">
							<div class="mm-uni-status" data-health aria-live="polite">${ esc( healthText( null ) ) }</div>
						</div>
						<label class="mm-field"><span>Captain name</span><input type="text" maxlength="24" autocomplete="off" spellcheck="false" data-name value="${ esc( name ) }" placeholder="Captain"></label>
						<div class="mm-actions">
							<button type="button" class="tw-btn tw-btn-primary" data-join>${ icon( 'play' ) }<span>Join the universe</span></button>
							<div class="mm-note" data-note></div>
						</div>
						<div class="mm-links">
							<button type="button" data-controls>Controls<kbd>F1</kbd></button>
							<button type="button" data-guide>Replay the guide</button>
							<button type="button" data-credits>Credits</button>
							${ this.cancelable ? '<button type="button" data-cancel>Cancel<kbd>Esc</kbd></button>' : '' }
							<span>The host's server keeps this game</span>
						</div>
					</section>
				</div>
			</div>`;
		const q = ( sel ) => this.el.querySelector( sel );
		this.nameEl = q( '[data-name]' );
		this.serverEl = q( '[data-server]' );
		this.noteEl = q( '[data-note]' );
		this.statusEl = q( '[data-status]' );
		this.joinBtn = q( '[data-join]' );
		this.newBtn = null;
		this.healthEl = q( '[data-health]' );
		this.joinBtn.addEventListener( 'click', () => this._join() );
		q( '[data-modes]' ).addEventListener( 'click', () => this._toModes() );
		// the address: a new one is asked about (after a pause in the typing); "default" / "last used" put one back
		const setAddress = ( v ) => {

			this.serverEl.value = v;
			this._addressChanged( true );

		};
		q( '[data-default]' ).addEventListener( 'click', () => setAddress( def ) );
		q( '[data-last]' ).addEventListener( 'click', () => setAddress( last ) );
		this.serverEl.addEventListener( 'input', () => this._addressChanged( false ) );
		this.serverEl.addEventListener( 'change', () => this._addressChanged( true ) );
		this._bindSeg();
		this._bindLinks();
		this._health = null;
		this._uniNote( shared ? 'One click: the shared universe keeps your captain\'s game.' : 'Join asks the server first: nothing starts until it answers.' );
		this._checkHealth();
		( name ? this.joinBtn : this.nameEl ).focus( { preventScroll: true } );

	}

	// the address box changed: the default link shows when it is not the default, the health is asked again
	_addressChanged( now ) {

		const def = defaultUniverseAddress();
		const url = normalizeUniverseUrl( this.serverEl ? this.serverEl.value : '' );
		const d = this.el.querySelector( '[data-default]' );
		if ( d ) d.hidden = !! url && url === normalizeUniverseUrl( def );
		clearTimeout( this._healthTimer );
		if ( now ) this._checkHealth();
		else this._healthTimer = setTimeout( () => this._checkHealth(), 700 );

	}

	// GET /health of the address in the box: online and how many aboard, updating (another commit of the game), offline and why
	async _checkHealth() {

		const el = this.healthEl;
		if ( ! el || this.view !== 'main' ) return null;
		const url = normalizeUniverseUrl( this.serverEl ? this.serverEl.value : '' );
		const n = this._healthSeq = ( this._healthSeq || 0 ) + 1;
		this._health = null;
		el.textContent = url ? healthText( null ) : 'Type a server address';
		el.classList.remove( 'is-ok', 'is-warn' );
		if ( ! url ) return null;
		const hp = await probeHealth( url );
		if ( n !== this._healthSeq || ! this.open || el !== this.healthEl ) return null;
		this._health = { url, ...hp };
		el.textContent = healthText( hp );
		el.classList.toggle( 'is-ok', !! hp.online && ! hp.updating );
		el.classList.toggle( 'is-warn', ! hp.online || !! hp.updating );
		return this._health;

	}

	_uniNote( text, warn = false ) {

		if ( ! this.noteEl ) return;
		this.noteEl.textContent = text;
		this.noteEl.classList.toggle( 'is-warn', warn );

	}

	// probe the server; on yes the session is attached and the menu resolves (App.startSession connects)
	async _join() {

		if ( this.view !== 'main' || this._joining ) return;
		const url = normalizeUniverseUrl( this.serverEl ? this.serverEl.value : '' );
		const name = this.nameEl ? this.nameEl.value.trim() : '';
		if ( ! url ) return this._uniNote( 'Type the server address, e.g. 192.168.1.20 or myisland.example.com', true );
		// a server on another commit of the game is being deployed (or this page is older): say so instead of a refusal
		if ( this._health && this._health.url === url && this._health.online && this._health.updating ) {

			this._checkHealth();
			return this._uniNote( UPDATING_TEXT, true );

		}

		const n = this._joining = performance.now();
		this.joinBtn.disabled = true;
		this._uniNote( `Asking ${ url } ...` );
		const st = this.state;
		try {

			const r = await probeUniverse( url, name, { character: st ? st.character : null } );
			if ( this._joining !== n || ! this.open ) return;
			remember( SERVER_KEY, this.serverEl.value.trim() );
			remember( NAME_KEY, r.captain );
			if ( this.statusEl ) {

				this.statusEl.textContent = `${ r.universe ? r.universe.name : 'universe' } · ${ r.players }/${ r.cap || '?' } online · ${ r.exists ? 'your game is there' : 'a new captain' }`;
				this.statusEl.classList.add( 'is-ok' );

			}

			const session = new UniverseSession( { url, captain: r.captain, profile: r.profile, info: r.universe } );
			if ( this.app && this.app.game ) session.attach( this.app );
			this._finish( { mode: 'multiplayer', slot: 0, name: r.captain, server: url, newGame: ! r.exists, online: true, universe: session } );

		} catch ( e ) {

			if ( this._joining !== n ) return;
			this._joining = 0;
			if ( this.joinBtn ) this.joinBtn.disabled = false;
			this._uniNote( e && e.message ? e.message : 'The server did not answer', true );
			if ( this.statusEl ) {

				this.statusEl.textContent = e && e.code === 'name' ? 'Name taken on that server' : 'Not joined';
				this.statusEl.classList.remove( 'is-ok' );

			}

		}

	}

	_toModes() {

		this.step = 'modes';
		this._renderMain();

	}

	_renderSlots() {

		const box = this.el.querySelector( '.mm-slots' );
		if ( ! box ) return;
		const list = this._list = GameState.listSlots( this.storage, this.slots, this.mode );
		box.innerHTML = list.map( ( r ) => slotHTML( r, r.slot === this.selected, this.mode ) ).join( '' );
		this._rows = [ ...box.querySelectorAll( '.mm-slot' ) ];
		for ( const row of this._rows ) {

			const slot = Number( row.dataset.slot );
			row.addEventListener( 'click', ( e ) => {

				if ( e.target.closest( '[data-del]' ) ) return;
				this._select( slot );

			} );
			row.addEventListener( 'dblclick', ( e ) => {

				if ( e.target.closest( '[data-del]' ) ) return;
				this._select( slot );
				this._play( false );

			} );
			const del = row.querySelector( '[data-del]' );
			if ( del ) del.addEventListener( 'click', ( e ) => {

				e.stopPropagation();
				this._delete( slot, del );

			} );

		}

		this._note();

	}

	_select( slot ) {

		if ( slot === this.selected ) return;
		this.selected = slot;
		this._arm = null;
		for ( const row of this._rows ) {

			const on = Number( row.dataset.slot ) === slot;
			row.classList.toggle( 'is-on', on );
			row.setAttribute( 'aria-selected', String( on ) );
			if ( on ) row.focus( { preventScroll: false } );
			const d = row.querySelector( '[data-del]' );
			if ( d ) { d.classList.remove( 'is-arm' ); d.textContent = 'Delete'; }

		}

		if ( this.newBtn ) { this.newBtn.classList.remove( 'is-arm' ); this.newBtn.querySelector( 'span' ).textContent = 'New game'; }
		// an islander's own name comes with the slot
		const r = this._list[ slot ];
		if ( r && r.exists && r.name && this.nameEl ) this.nameEl.value = r.name;
		this._note();

	}

	_note( text = null, warn = false ) {

		if ( ! this.noteEl ) return;
		if ( text === null ) {

			const r = this._list && this._list[ this.selected ];
			const free = this.mode === 'sandbox' ? ' Everything is free here.' : '';
			text = r && r.exists ? `Play continues ${ r.name || 'this islander' }'s game · New game starts slot ${ r.slot + 1 } over` : `Slot ${ this.selected + 1 } is empty: Play starts a new islander here.${ free }`;
			warn = false;

		}

		this.noteEl.textContent = text;
		this.noteEl.classList.toggle( 'is-warn', warn );

	}

	_choice( newGame ) {

		const r = this._list && this._list[ this.selected ];
		const online = this.mode === 'multiplayer';
		return {
			mode: this.mode,
			slot: this.selected,
			name: this.nameEl ? this.nameEl.value.trim().slice( 0, 24 ) : '',
			server: online ? this._roomServer() : '',
			newGame: newGame || ! ( r && r.exists ),
			online,
		};

	}

	// the island / crew room typed (never the universe address a universe game left behind in App.serverOverride)
	_roomServer() {

		const v = this.serverEl ? this.serverEl.value.trim() : '';
		return v && ! isUniverseUrl( v ) ? v : defaultServerUrl();

	}

	_play() {

		if ( this.view !== 'main' || this.step !== 'slots' ) return;
		if ( this.mode === 'multiplayer' && this.netWay === 'universe' ) return this._join();
		this._finish( this._choice( false ) );

	}

	// New game on an existing slot asks once: the button turns red, a second click within 4 s confirms
	_newGame() {

		const r = this._list && this._list[ this.selected ];
		if ( ! ( r && r.exists ) ) return this._finish( this._choice( true ) );
		const a = this._arm;
		if ( a && a.kind === 'new' && a.slot === this.selected && performance.now() - a.t < 4000 ) return this._finish( this._choice( true ) );
		this._arm = { kind: 'new', slot: this.selected, t: performance.now() };
		this.newBtn.classList.add( 'is-arm' );
		this.newBtn.querySelector( 'span' ).textContent = `Overwrite slot ${ this.selected + 1 }?`;
		this._note( `Click again to start slot ${ this.selected + 1 } over: ${ r.name || 'this islander' }'s game will be lost`, true );
		setTimeout( () => {

			if ( this._arm && this._arm.kind === 'new' && this._arm.slot === r.slot && this.newBtn ) {

				this._arm = null;
				this.newBtn.classList.remove( 'is-arm' );
				this.newBtn.querySelector( 'span' ).textContent = 'New game';
				this._note();

			}

		}, 4000 );

	}

	_delete( slot, btn ) {

		const a = this._arm;
		if ( a && a.kind === 'del' && a.slot === slot && performance.now() - a.t < 4000 ) {

			this._arm = null;
			// only the stored save goes: a game running behind the menu (Load) is not touched
			GameState.removeSlot( this.storage, slot, this.mode );
			this._renderSlots();
			if ( this.ui && this.ui.toast ) this.ui.toast( `${ modeLabel( this.mode ) } slot ${ slot + 1 } cleared` );
			return;

		}

		this._arm = { kind: 'del', slot, t: performance.now() };
		btn.classList.add( 'is-arm' );
		btn.textContent = 'Delete?';
		setTimeout( () => {

			if ( this._arm && this._arm.kind === 'del' && this._arm.slot === slot ) {

				this._arm = null;
				btn.classList.remove( 'is-arm' );
				btn.textContent = 'Delete';

			}

		}, 4000 );

	}

	// ---- keys: the menu owns the keyboard while it is up (the controls sheet gets them when open)

	_key( e ) {

		if ( ! this.open || e.type !== 'keydown' ) return; // keyups pass (the game's held keys clear)
		const help = this.ui && this.ui.helpEl;
		if ( help && ! help.hidden ) return; // the F1 sheet is over us: its own Escape / F1
		if ( this.credits && this.credits.isOpen ) return; // so is the credits panel
		e.stopPropagation();
		const code = e.code;
		if ( this.step === 'modes' ) {

			const i = MODE_IDS.indexOf( this.mode );
			if ( code === 'ArrowRight' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowUp' ) {

				e.preventDefault();
				const d = code === 'ArrowRight' || code === 'ArrowDown' ? 1 : MODE_IDS.length - 1;
				this._highlightMode( MODE_IDS[ ( i + d ) % MODE_IDS.length ] );

			} else if ( code === 'Enter' || code === 'NumpadEnter' || code === 'Space' ) {

				e.preventDefault();
				this._pickMode( this.mode );

			} else if ( /^(Digit|Numpad)[1-9]$/.test( code ) && MODE_IDS[ Number( code.slice( -1 ) ) - 1 ] ) {

				e.preventDefault();
				this._pickMode( MODE_IDS[ Number( code.slice( -1 ) ) - 1 ] );

			} else if ( code === 'Escape' && this.cancelable ) {

				e.preventDefault();
				this._finish( null );

			}

			return;

		}

		if ( code === 'Escape' ) {

			e.preventDefault();
			if ( this.cancelable ) this._finish( null );
			else this._toModes();
			return;

		}

		if ( this.mode === 'multiplayer' && this.netWay === 'universe' ) {

			if ( code === 'Enter' || code === 'NumpadEnter' ) {

				e.preventDefault();
				this._join();

			}

			return;

		}

		if ( code === 'ArrowUp' || code === 'ArrowDown' ) {

			if ( isTyping( e.target ) && e.target !== this.nameEl ) return;
			e.preventDefault();
			const n = this._list ? this._list.length : this.slots;
			this._select( ( this.selected + ( code === 'ArrowDown' ? 1 : n - 1 ) ) % n );

		} else if ( code === 'Enter' || code === 'NumpadEnter' ) {

			e.preventDefault();
			this._play( false );

		}

	}

}

// ---- pieces

function slotHTML( r, on, mode ) {

	const c = CHARACTERS[ r.character ] || CHARACTERS[ DEFAULT_CHARACTER ];
	const boat = r.boat && BOATS[ r.boat ] ? BOATS[ r.boat ].name : 'On foot';
	const face = r.exists
		? `<img class="mm-face" src="${ portraitUrl( r.character ) }" alt="" draggable="false">`
		: `<div class="mm-face is-empty" aria-hidden="true">${ icon( 'anchor' ) }</div>`;
	// (nothing costs in the sandbox: no purse there)
	const purse = mode === 'sandbox' ? '' : ` · <b>$${ Math.round( r.money ).toLocaleString() }</b>`;
	const body = r.exists
		? `<div class="mm-slot-name">${ esc( r.name || c.name ) }</div>
			<div class="mm-slot-meta">Lv ${ r.level } ${ esc( rankTitle( r.level ) ) }${ purse } · ${ esc( boat ) } · ${ played( r.playSeconds ) }</div>
			<div class="mm-slot-when">${ r.name ? esc( c.name ) + ' · ' : '' }${ r.savedAt ? 'saved ' + ago( r.savedAt ) : 'an older save' }</div>`
		: `<div class="mm-slot-name">Empty slot</div><div class="mm-slot-meta">A new islander starts here</div>`;
	return `<div class="mm-slot ${ on ? 'is-on' : '' } ${ r.exists ? '' : 'is-empty' }" role="option" tabindex="0" data-slot="${ r.slot }" aria-selected="${ on }">
		${ face }
		<div class="mm-slot-text">${ body }</div>
		<span class="mm-slot-no">${ r.slot + 1 }</span>
		${ r.exists ? '<button type="button" class="mm-del" data-del>Delete</button>' : '' }
	</div>`;

}

function played( secs ) {

	const s = secs | 0;
	if ( s < 60 ) return 'just started';
	if ( s < 3600 ) return `${ Math.floor( s / 60 ) } min`;
	return `${ Math.floor( s / 3600 ) } h ${ Math.floor( s % 3600 / 60 ) } min`;

}

function ago( ts ) {

	const d = Math.max( 0, Date.now() - ts );
	if ( d < 60e3 ) return 'just now';
	if ( d < 3600e3 ) return `${ Math.floor( d / 60e3 ) } min ago`;
	if ( d < 86400e3 ) return `${ Math.floor( d / 3600e3 ) } h ago`;
	const days = Math.floor( d / 86400e3 );
	return days === 1 ? 'yesterday' : `${ days } days ago`;

}

function esc( s ) {

	return String( s ?? '' ).replace( /[&<>"']/g, ( ch ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ ch ] ) );

}

function isTyping( t ) {

	return !! ( t && ( t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ) );

}

// the 2560 wide art on a big or dense screen, else the 1280 one
export function artPath( width = null, dpr = null ) {

	let w = 1280;
	try {

		w = ( width ?? window.innerWidth ?? 1280 ) * Math.min( 2, dpr ?? window.devicePixelRatio ?? 1 );

	} catch ( e ) { /* no window */ }

	return w > ART.breakpoint ? ART.wide : ART.narrow;

}

function base() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}
