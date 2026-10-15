import { icon } from './icons.js';
import { t } from '../i18n/index.js';

// The Credits panel: who made what, with the licence of every third-party piece. A short in-game version of
// CREDITS.md at the project root (that file has the full list and the licence texts; keep the two in step).
//
//   const credits = new Credits( { ui } );   // ui.root hosts it (document.body without one)
//   credits.open( { returnFocus } ) / close() / toggle()   // credits.isOpen
//
// Opened from the main menu's links and the pause menu. While it is up it owns the keyboard (Escape closes it):
// its listener is added on open, after the menus' own, so a menu that hosts it returns early from its key handler
// while credits.isOpen.

// the owner fills this in (CREDITS.md says the same)
export const ART_CREDIT = 'Hyptile Island art: [owner name - to fill in]';

// [ title, [ what, who, licence ] rows ]
export const CREDIT_SECTIONS = [
	[ 'Hyptile Island', [
		[ 'Characters, portraits, menu and loader key art', ART_CREDIT, 'the owner\'s own work (local ComfyUI, Blender)' ],
		[ 'Design source: the Unreal game Upside-Down Fishing and its naval fork', 'the project owner', 'the owner\'s own project' ],
		[ 'Captain Roid: model and clicking voice', 'the project owner (ComfyUI; ElevenLabs text-to-sound)', 'the owner\'s own work' ],
		[ 'Fleet, ships, ship modules, marine life, harbour props, authored animations', 'the project owner (naval fork)', 'the owner\'s own work' ],
		[ 'Melee, cannon and impact sounds', 'the project owner (ElevenLabs generations)', 'the owner\'s own work' ],
	] ],
	[ 'Made with', [
		[ 'Claude Code (Anthropic: Fable, Opus and Sonnet agents)', 'root integration and most of the browser code', 'tooling' ],
		[ 'OpenAI Codex / ChatGPT, OpenCode free models, JEV via OpenRouter', 'the Unreal and naval-fork phases', 'tooling' ],
		[ 'Unreal Engine 5.8, Blender 5.2, ComfyUI (TRELLIS.2), ElevenLabs', 'the original game, models and rigs, art, sounds', 'tooling; generated on the owner accounts' ],
	] ],
	[ 'Open source we built with', [
		[ 'Tidewater: engine, island, ocean, sky, fishing', 'DRG Software Solutions LLC (github.com/dgreenheck/tidewater)', 'MIT' ],
		[ 'Field recordings (public/audio)', 'the Freesound recordists listed in public/audio/CREDITS.md', 'CC0 1.0' ],
		[ 'Beach debris scans, stall textures and props', 'Poly Haven', 'CC0 1.0' ],
		[ 'Vendor avatars and 15 motion-capture clips', 'Microsoft Rocketbox Avatar Library (c) 2020 Microsoft', 'MIT' ],
		[ 'SMAA lookup textures, SMAA / FXAA ports', 'three.js authors; J. Jimenez et al.', 'MIT' ],
		[ 'Cloud scheme', 'DRG Software Solutions, Sky Pro WebGPU', 'MIT' ],
	] ],
	[ 'Software', [
		[ 'Rapier physics (@dimforge/rapier3d-compat 0.21)', 'Dimforge EURL', 'Apache-2.0' ],
		[ 'Colyseus, @colyseus/sdk, @colyseus/schema', 'Endel Dreyer', 'MIT' ],
		[ 'ws (relay server)', 'Einar Otto Stangvik, Arnout Kazemier, Luigi Pinca and contributors', 'MIT' ],
		[ 'Vite (build)', 'VoidZero Inc. and Vite contributors', 'MIT' ],
		[ 'webgpu / Dawn (tests only)', 'The Dawn & Tint Authors', 'MIT / BSD-3-Clause' ],
		[ 'three.js (installed, not used by the game)', 'three.js authors', 'MIT' ],
		[ 'three-avbd (evaluated, not shipped)', 'Steven Bobyn', 'MIT' ],
		[ 'Colyseus agent skill (development)', 'Endel Dreyer', 'MIT' ],
	] ],
	[ 'Fonts', [
		[ 'Inter, JetBrains Mono, Caveat Brush, Kalam (Google Fonts)', 'Rasmus Andersson; JetBrains; Impallari Type; Indian Type Foundry', 'OFL 1.1' ],
		[ 'Stall signs: Permanent Marker, Cabin Sketch, Oswald', 'Font Diner; The Cabin Project Authors; The Oswald Project Authors', 'Apache-2.0 / OFL 1.1' ],
	] ],
];

const CSS = /* css */`
.cr { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; padding: var(--tw-5);
	background: rgba(4, 14, 24, 0.55); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); }
.cr-card { width: min(calc(820 * var(--tw-u)), 100%); max-height: calc(100vh - 2 * var(--tw-5)); display: flex; flex-direction: column;
	padding: var(--tw-5) var(--tw-6); border-radius: var(--tw-r-lg); }
.cr-head { display: flex; align-items: center; justify-content: space-between; gap: var(--tw-4); margin-bottom: var(--tw-3); }
.cr-head h2 { margin: 0; font-size: clamp(18px, 2vw, 26px); font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; }
.cr-close { display: inline-flex; align-items: center; gap: var(--tw-2); padding: var(--tw-1) var(--tw-3); }
.cr-close kbd { padding: 0 4px; border-radius: 4px; background: var(--tw-fill-2); font: 500 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-3); }
.cr-body { overflow: auto; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2); }
.cr h3 { margin: var(--tw-4) 0 var(--tw-2); font-size: var(--tw-fs-xs); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tw-ink-3); }
.cr h3:first-child { margin-top: 0; }
.cr-row { display: grid; grid-template-columns: 1.3fr 1.2fr auto; gap: var(--tw-3); padding: var(--tw-2) 0; border-top: 1px solid var(--tw-line); font-size: var(--tw-fs-sm); }
.cr-row span:nth-child(2) { color: var(--tw-ink-2); }
.cr-row span:nth-child(3) { color: var(--tw-sun); font-family: var(--tw-mono); font-size: var(--tw-fs-xs); white-space: nowrap; }
@media (max-width: 640px) { .cr-row { grid-template-columns: 1fr; gap: 2px; } .cr-card { padding: var(--tw-4); } }
.cr-foot { margin-top: var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-xs); }
`;

function esc( s ) {

	return String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' } )[ c ] );

}

// the panel's inner HTML (plain string: the tests read it without a DOM)
export function creditsHTML() {

	const sections = CREDIT_SECTIONS.map( ( [ title, rows ] ) => `<h3>${ esc( title ) }</h3>${ rows.map( ( r ) =>
		`<div class="cr-row"><span>${ esc( r[ 0 ] ) }</span><span>${ esc( r[ 1 ] ) }</span><span>${ esc( r[ 2 ] ) }</span></div>` ).join( '' ) }` ).join( '' );
	return `<div class="cr-card tw-glass" role="dialog" aria-modal="true" aria-label="${ esc( t( 'credits.title', 'Credits' ) ) }">
		<div class="cr-head"><h2>${ esc( t( 'credits.title', 'Credits' ) ) }</h2>
			<button type="button" class="tw-btn tw-btn-ghost cr-close" data-close>${ icon( 'close' ) }<span>${ esc( t( 'credits.close', 'Close' ) ) }</span><kbd>Esc</kbd></button></div>
		<div class="cr-body">${ sections }</div>
		<div class="cr-foot">${ esc( t( 'credits.foot', 'The full list and the licence texts are in CREDITS.md next to the game.' ) ) }</div>
	</div>`;

}

export class Credits {

	constructor( { ui = null } = {} ) {

		this.ui = ui;
		this.el = null;
		this.isOpen = false;
		this._return = null;
		this._onKey = ( e ) => this._key( e );

	}

	_build() {

		if ( typeof document === 'undefined' ) return null;
		if ( ! document.getElementById( 'cr-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'cr-style';
			style.textContent = CSS;
			document.head.append( style );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'cr tw-interactive';
		el.hidden = true;
		// clicks stay in the panel (the game behind must not take them); a click on the dimmed backdrop closes
		for ( const ty of [ 'pointerdown', 'mousedown', 'dblclick', 'wheel', 'touchstart' ] ) el.addEventListener( ty, ( e ) => e.stopPropagation(), { passive: true } );
		el.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			if ( e.target === el || e.target.closest( '[data-close]' ) ) this.close();

		} );
		( this.ui && this.ui.root ? this.ui.root : document.body ).append( el );
		return el;

	}

	open( { returnFocus = null } = {} ) {

		if ( this.isOpen ) return;
		const el = this.el || this._build();
		if ( ! el ) return;
		this._return = returnFocus || ( typeof document !== 'undefined' ? document.activeElement : null );
		el.innerHTML = creditsHTML(); // rebuilt each time: the language may have changed
		el.hidden = false;
		this.isOpen = true;
		window.addEventListener( 'keydown', this._onKey, { capture: true } );
		const b = el.querySelector( '[data-close]' );
		if ( b ) b.focus();

	}

	close() {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		window.removeEventListener( 'keydown', this._onKey, { capture: true } );
		if ( this.el ) this.el.hidden = true;
		const r = this._return;
		this._return = null;
		if ( r && r.focus && r.isConnected ) r.focus();

	}

	toggle() {

		if ( this.isOpen ) this.close();
		else this.open();

	}

	// the panel owns the keyboard: Escape closes, the arrows scroll, nothing reaches the game
	_key( e ) {

		if ( ! this.isOpen ) return;
		e.stopPropagation();
		if ( e.code === 'Escape' && ! e.repeat ) {

			e.preventDefault();
			this.close();

		} else if ( e.code === 'ArrowDown' || e.code === 'ArrowUp' ) {

			e.preventDefault();
			const body = this.el && this.el.querySelector( '.cr-body' );
			if ( body ) body.scrollTop += e.code === 'ArrowDown' ? 60 : - 60;

		}

	}

	dispose() {

		this.close();
		if ( this.el ) this.el.remove();
		this.el = null;

	}

}
