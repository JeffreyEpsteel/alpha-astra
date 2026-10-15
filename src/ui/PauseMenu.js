import { CHARACTERS, DEFAULT_CHARACTER } from '../game/Characters.js';
import { Credits } from './Credits.js';
import { rankTitle } from '../game/Progression.js';
import { modeLabel, isOnlineSession } from '../game/GameMode.js';
import { icon } from './icons.js';
import { t, tx } from '../i18n/index.js';

// The in-game menu: Escape with nothing else open, or the menu button at the top of the settings rail.
//
//   const pause = new PauseMenu( { ui, app } );      // app.pauseMenu
//   pause.open() / close() / toggle()                // pause.isOpen
//
//   Resume      back to the game (Esc)
//   Save game   writes the current slot now (app.saveNow) and says "Saved"
//   Load        the slot list of the main menu for this mode (the current game is saved first); picking a slot
//               loads it in place (app.startSession), Cancel comes back here
//   Settings    the settings panel (H)
//   Controls    the controls sheet (F1)
//   Main menu   saves, then reloads the page on the main menu (the mode choice): the simplest clean restart
//
// While it is up the game takes no input and, in the single-player modes, stops its clock (app.setMenuOpen).
// In multiplayer the island keeps running. Escape with the settings panel, the photo mode or any game panel
// open closes that instead: the menu opens on an Escape that has nothing else to close.
// With the mouse captured the browser keeps the first Escape for itself (it only releases the mouse, no key
// event comes through): the menu opens on that release too, when the page still has focus and nothing is open.

// sessionStorage flag: the next page load opens on the main menu even with ?nomenu / ?bg (used by main.js)
export const MENU_FLAG = 'alpha-astra.menu';

const CSS = /* css */`
.pm { position: absolute; inset: 0; z-index: 26; display: grid; place-items: center; padding: var(--tw-5); overflow: auto;
	background: radial-gradient(ellipse 90% 80% at 50% 45%, rgba(3, 10, 16, 0.32), rgba(3, 10, 16, 0.8)); opacity: 0;
	transition: opacity var(--tw-med) var(--tw-ease); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); }
.pm.is-on { opacity: 1; }
.pm:not(.is-on) { pointer-events: none; }
.pm-card { width: min(calc(380 * var(--tw-u)), 100%); padding: var(--tw-5) var(--tw-6); border-radius: var(--tw-r-lg); display: flex; flex-direction: column; gap: var(--tw-2);
	transform: translateY(calc(8 * var(--tw-u))); transition: transform 500ms var(--tw-ease); }
.pm.is-on .pm-card { transform: none; }
.pm-title { font-size: calc(20 * var(--tw-u)); font-weight: 600; letter-spacing: 0.24em; text-shadow: 0 2px 24px rgba(0, 0, 0, 0.5); }
.pm-sub { margin: 0 0 var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.pm-sub b { color: var(--tw-aqua); font-weight: 600; }
.pm-card .tw-btn { justify-content: space-between; }
.pm-card .tw-btn .tw-ico { width: calc(16 * var(--tw-u)); height: calc(16 * var(--tw-u)); flex: none; }
.pm-card .tw-btn > span { display: inline-flex; align-items: center; gap: var(--tw-2); }
.pm-card .tw-btn kbd { padding: 0 5px; border-radius: 4px; background: rgba(0, 0, 0, 0.18); font: 500 var(--tw-fs-xs) var(--tw-mono); }
.pm-card .tw-btn.is-done { color: #06281f; background: linear-gradient(180deg, #8ff0c4, #5fe3b0); box-shadow: 0 0 0 1px rgba(95, 227, 176, 0.6); }
.pm-card .tw-btn.is-bad { color: #2a0a0e; background: linear-gradient(180deg, #ff9aa2, #ff7a85); }
.pm-gap { height: var(--tw-1); }
.pm-note { margin-top: var(--tw-2); min-height: 1.4em; font-size: var(--tw-fs-sm); color: var(--tw-ink-3); }
.tw-root.is-photo .pm { display: none; }
`;

export class PauseMenu {

	constructor( { ui, app } ) {

		this.ui = ui;
		this.app = app;
		this.isOpen = false;
		this._saveT = null;
		if ( ! document.getElementById( 'pm-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'pm-style';
			style.textContent = CSS;
			document.head.append( style );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'pm tw-interactive';
		el.hidden = true;
		for ( const ev of [ 'pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'touchstart' ] ) el.addEventListener( ev, ( e ) => e.stopPropagation(), { passive: true } );
		el.addEventListener( 'contextmenu', ( e ) => { e.stopPropagation(); e.preventDefault(); } );
		( ui && ui.root ? ui.root : document.body ).append( el );

		// the menu button at the top of the settings rail
		if ( ui && ui.rail ) {

			const b = this.railBtn = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'tw-rail-btn';
			b.setAttribute( 'aria-label', t( 'pause.menu', 'Menu' ) );
			b.dataset.tip = t( 'pause.menu_esc', 'Menu (Esc)' );
			b.dataset.tipSide = 'left';
			b.innerHTML = icon( 'pause' );
			b.addEventListener( 'click', () => this.toggle() );
			const sep = document.createElement( 'span' );
			sep.className = 'tw-rail-sep';
			ui.rail.prepend( b, sep );

		}

		// Escape is read before the UI's own handler (capture phase) so it can tell whether it closed something
		this._onEsc = ( e ) => this._escape( e );
		window.addEventListener( 'keydown', this._onEsc, { capture: true } );
		this._onKey = ( e ) => this._key( e );
		// the mouse let go with nothing open: that was the browser's Escape
		this._wasLocked = false;
		document.addEventListener( 'pointerlockchange', () => {

			if ( document.pointerLockElement ) {

				this._wasLocked = true;
				return;

			}

			if ( ! this._wasLocked ) return;
			this._wasLocked = false;
			if ( document.hasFocus && ! document.hasFocus() ) return; // the window was left, not Escape
			setTimeout( () => this._lockLost(), 0 );

		} );

	}

	// anything that wants this Escape for itself?
	_busy() {

		const ui = this.ui, app = this.app, hud = app.game && app.game.hud;
		if ( ui._start || ui.helpOpen || ui._menu ) return true; // the start overlay, the controls sheet, a dropdown: their own Escape
		if ( app.game?.guide?.open ) return true;
		if ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen || hud.catchOpen ) ) return true; // Game.update closes them
		if ( app.chat && app.chat.isOpen ) return true;
		if ( app.features && app.features.panelOpen() ) return true; // a feature panel (world map, dialogue): its own Escape
		return false;

	}

	_escape( e ) {

		if ( e.code !== 'Escape' || e.repeat || this.isOpen || e.ctrlKey || e.metaKey || e.altKey ) return;
		const app = this.app, ui = this.ui;
		if ( ! app.session || ( app.menu && app.menu.open ) ) return;
		const tg = e.target;
		if ( tg && ( tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable ) ) return;
		if ( this._busy() ) return;
		// settings panel and photo mode close first; the next Escape opens the menu
		if ( ui.photoMode ) { ui.setPhotoMode( false ); return; }
		if ( ui.panelOpen ) { ui.togglePanel( false ); return; }
		e.preventDefault();
		this.open();

	}

	_lockLost() {

		const app = this.app, ui = this.ui;
		if ( this.isOpen || ! app.session || ( app.menu && app.menu.open ) || document.pointerLockElement ) return;
		if ( ui.photoMode || ui.panelOpen || this._busy() ) return;
		this.open();

	}

	toggle() {

		if ( this.isOpen ) this.close();
		else this.open();

	}

	open() {

		const app = this.app;
		if ( this.isOpen || ! app.session ) return false;
		this.isOpen = true;
		this._render();
		const el = this.el;
		el.hidden = false;
		void el.offsetWidth;
		el.classList.add( 'is-on' );
		try {

			if ( document.pointerLockElement ) document.exitPointerLock?.();

		} catch ( err ) { /* no pointer lock */ }

		app.setMenuOpen( true );
		window.addEventListener( 'keydown', this._onKey, { capture: true } );
		const first = el.querySelector( '[data-resume]' );
		if ( first ) first.focus( { preventScroll: true } );
		return true;

	}

	close() {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		clearTimeout( this._saveT );
		const el = this.el;
		el.classList.remove( 'is-on' );
		window.removeEventListener( 'keydown', this._onKey, { capture: true } );
		const a = document.activeElement;
		if ( a && el.contains( a ) ) a.blur();
		setTimeout( () => { if ( ! this.isOpen ) { el.hidden = true; el.innerHTML = ''; } }, 450 );
		this.app.setMenuOpen( false );

	}

	// ---- the sheet

	_render() {

		const app = this.app, st = app.game ? app.game.state : null;
		const online = isOnlineSession( app );
		const who = st ? ( st.name || ( CHARACTERS[ st.character ] || CHARACTERS[ DEFAULT_CHARACTER ] ).name ) : '';
		const sub = st ? `${ esc( who ) } · <b>${ esc( tx( modeLabel( st.mode ) ) ) }</b> · ${ esc( t( 'pause.slot', 'slot {n}', { n: st.slot + 1 } ) ) } · ${ esc( tx( rankTitle( st.level ) ) ) }` : '';
		const note = online ? t( 'pause.note.online', 'The island keeps running while this is open.' ) : app.rules.autosave ? t( 'pause.note.autosave', 'The game is saved every minute and when you leave the page.' ) : '';
		this.el.innerHTML = `
			<div class="pm-card tw-glass" role="dialog" aria-modal="true" aria-label="${ esc( online ? t( 'pause.menu', 'Menu' ) : t( 'pause.paused', 'Paused' ) ) }">
				<div class="pm-title">${ esc( online ? t( 'pause.title.menu', 'MENU' ) : t( 'pause.title.paused', 'PAUSED' ) ) }</div>
				<div class="pm-sub">${ sub }</div>
				<button type="button" class="tw-btn tw-btn-primary" data-resume><span>${ icon( 'play' ) }${ esc( t( 'pause.resume', 'Resume' ) ) }</span><kbd>Esc</kbd></button>
				${ online ? '' : `<button type="button" class="tw-btn tw-btn-default" data-save><span>${ icon( 'check' ) }<i data-save-text style="font-style:normal">${ esc( t( 'pause.save', 'Save game' ) ) }</i></span></button>
				<button type="button" class="tw-btn tw-btn-default" data-load><span>${ icon( 'refresh' ) }${ esc( t( 'pause.load', 'Load' ) ) }</span></button>
				<button type="button" class="tw-btn tw-btn-default" data-saves><span>${ icon( 'grid' ) }${ esc( t( 'pause.saves', 'Saves' ) ) }</span></button>` }
				<button type="button" class="tw-btn tw-btn-default" data-settings><span>${ icon( 'sliders' ) }${ esc( t( 'pause.settings', 'Settings' ) ) }</span><kbd>H</kbd></button>
				<button type="button" class="tw-btn tw-btn-default" data-controls><span>${ icon( 'help' ) }${ esc( t( 'pause.controls', 'Controls' ) ) }</span><kbd>F1</kbd></button>
				<button type="button" class="tw-btn tw-btn-default" data-credits><span>${ icon( 'sparkles' ) }${ esc( t( 'pause.credits', 'Credits' ) ) }</span></button>
				<div class="pm-gap"></div>
				<button type="button" class="tw-btn tw-btn-ghost" data-home><span>${ icon( 'anchor' ) }${ esc( t( 'pause.home', 'Main menu' ) ) }</span></button>
				<div class="pm-note" data-note>${ esc( note ) }</div>
			</div>`;
		const q = ( s ) => this.el.querySelector( s );
		this.noteEl = q( '[data-note]' );
		this.saveBtn = q( '[data-save]' );
		this.saveText = q( '[data-save-text]' );
		q( '[data-resume]' ).addEventListener( 'click', () => this.close() );
		this.saveBtn?.addEventListener( 'click', () => this._save() );
		q( '[data-load]' )?.addEventListener( 'click', () => this._load() );
		q( '[data-settings]' ).addEventListener( 'click', () => this._settings() );
		q( '[data-controls]' ).addEventListener( 'click', () => this._controls() );
		q( '[data-home]' ).addEventListener( 'click', () => this._home() );
		q( '[data-credits]' ).addEventListener( 'click', () => ( this.credits ||= new Credits( { ui: this.ui } ) ).open() );
		// the save manager (export, import, backups: src/ui/SaveManager.js)
		q( '[data-saves]' )?.addEventListener( 'click', () => { const sv = this.app.features && this.app.features.get( 'saves' ); if ( sv && sv.open ) { this.close(); sv.open( { mode: this.app.mode } ); } } );

	}

	// writes the slot now; the button says Saved for a moment
	_save() {

		const ok = this.app.saveNow();
		if ( ! this.saveBtn ) return ok;
		this.saveBtn.classList.toggle( 'is-done', ok );
		this.saveBtn.classList.toggle( 'is-bad', ! ok );
		this.saveText.textContent = ok ? t( 'pause.saved', 'Saved' ) : t( 'pause.save_failed', 'Could not save' );
		if ( this.noteEl ) this.noteEl.textContent = ok ? t( 'pause.slot_saved', 'Slot {n} saved at {time}', { n: this.app.game.state.slot + 1, time: new Date().toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } ) } ) : t( 'pause.blocked', 'The browser blocked its storage: the game cannot save here.' );
		clearTimeout( this._saveT );
		this._saveT = setTimeout( () => {

			if ( ! this.saveBtn ) return;
			this.saveBtn.classList.remove( 'is-done', 'is-bad' );
			this.saveText.textContent = t( 'pause.save', 'Save game' );

		}, 2200 );
		if ( ok && this.ui.toast ) this.ui.toast( t( 'pause.saved', 'Saved' ), 1600 );
		return ok;

	}

	_settings() {

		this.close();
		if ( this.ui.togglePanel ) this.ui.togglePanel( true );

	}

	_controls() {

		if ( this.ui.toggleHelp ) this.ui.toggleHelp( true );

	}

	// back to the slot list of the main menu; the game behind it is saved first
	_load() {

		this.close();
		this.app.openLoadMenu();

	}

	// save, then restart on the main menu
	_home() {

		this.app.saveNow();
		try {

			sessionStorage.setItem( MENU_FLAG, '1' );

		} catch ( e ) { /* the menu shows anyway unless ?nomenu / ?bg is in the address */ }

		location.reload();

	}

	// ---- keys: the menu owns the keyboard while it is up (the controls sheet gets its own)

	_key( e ) {

		if ( ! this.isOpen ) return;
		const ui = this.ui;
		if ( ui.helpOpen ) return; // the F1 sheet is over us: its own Escape / F1
		if ( this.credits && this.credits.isOpen ) return;
		e.stopPropagation();
		const code = e.code;
		if ( code === 'Escape' ) {

			e.preventDefault();
			this.close();

		} else if ( code === 'KeyH' && ! e.repeat ) {

			e.preventDefault();
			this._settings();

		} else if ( code === 'F1' || e.key === '?' ) {

			e.preventDefault();
			if ( ! e.repeat ) this._controls();

		} else if ( code === 'ArrowDown' || code === 'ArrowUp' ) {

			e.preventDefault();
			const list = [ ...this.el.querySelectorAll( 'button' ) ];
			const i = list.indexOf( document.activeElement );
			const next = list[ ( ( i < 0 ? 0 : i ) + ( code === 'ArrowDown' ? 1 : list.length - 1 ) ) % list.length ];
			if ( next ) next.focus();

		}

	}

}

function esc( s ) {

	return String( s ?? '' ).replace( /[&<>"']/g, ( ch ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ ch ] ) );

}
