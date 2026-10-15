// A small glass window in the look of the game's HUD panels (the --tw-* tokens of ui/ui.css, .tw-glass, the
// trade window's layout), shared by the tavern (TavernPanel.js) and the crafting bench (features/crafting).
// The DOM is built lazily in app.ui.ui.hud the first time a window opens; nothing happens without a document.
//
//   class MyPanel extends GlassPanel { render() { this.body( html ) } onClick( act, el ) {} }
//   p.open() / p.close() / p.isOpen / p.refresh() (re-renders while open) / p.dispose()
//   p.onClose: called when Escape or the Close button shuts it

const CSS = /* css */`
.hb-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); width: min(calc(560 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge))); max-height: 84vh;
	display: flex; flex-direction: column; padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); z-index: 6; }
.hb-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.tw-root.is-photo .hb-panel { display: none; }
.hb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--tw-3); }
.hb-head h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.hb-sub { margin: 0; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.hb-sub b { color: var(--tw-sun); font-family: var(--tw-mono); font-weight: 600; }
.hb-btn { font: 600 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); background: var(--tw-fill-2); border: 0; border-radius: 999px; padding: var(--tw-2) var(--tw-4); cursor: pointer; white-space: nowrap; }
.hb-btn:hover:not([disabled]) { background: var(--tw-line-2); }
.hb-btn[disabled] { opacity: 0.35; cursor: default; }
.hb-btn.is-small { font-size: var(--tw-fs-sm); padding: 2px var(--tw-3); }
.hb-btn.is-gold { color: var(--tw-sun); }
.hb-tabs { display: flex; gap: var(--tw-1); margin: var(--tw-3) 0; padding: 3px; border-radius: 999px; background: var(--tw-fill); }
.hb-tab { flex: 1; font: 600 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink-2); background: none; border: 0; border-radius: 999px; padding: calc(5 * var(--tw-u)) var(--tw-3); cursor: pointer; }
.hb-tab:hover { color: var(--tw-ink); }
.hb-tab.is-on { background: var(--tw-fill-2); color: var(--tw-ink); box-shadow: inset 0 0 0 1px var(--tw-line-2); }
.hb-body { overflow: auto; min-height: 0; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2); }
.hb-body h3 { margin: var(--tw-3) 0 var(--tw-1); font-size: var(--tw-fs-xs); font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--tw-ink-3); }
.hb-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--tw-3); align-items: center; padding: calc(7 * var(--tw-u)) 0; border-bottom: 1px solid var(--tw-line); }
.hb-row b { display: block; font-weight: 600; }
.hb-row small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); line-height: 1.35; }
.hb-row small .is-ok { color: var(--tw-aqua); }
.hb-row small .is-miss { color: var(--tw-coral); }
.hb-price { font: 600 var(--tw-fs-md) var(--tw-mono); color: var(--tw-sun); white-space: nowrap; }
.hb-chips { display: flex; flex-wrap: wrap; gap: var(--tw-2); margin: var(--tw-1) 0; }
.hb-chip { padding: 2px var(--tw-3); border-radius: 999px; background: var(--tw-fill); border: 1px solid var(--tw-line); font-size: var(--tw-fs-sm); color: var(--tw-ink-2); }
.hb-chip b { color: var(--tw-ink); font-family: var(--tw-mono); }
.hb-list { margin: var(--tw-2) 0 0; padding: 0; list-style: none; color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.5; }
.hb-list li { padding: 3px 0; border-bottom: 1px solid var(--tw-line); }
.hb-empty { color: var(--tw-ink-3); padding: var(--tw-3) 0; font-size: var(--tw-fs-sm); }
.hb-msg { margin-top: var(--tw-3); padding-top: var(--tw-2); border-top: 1px solid var(--tw-line); color: var(--tw-ink-2); font-size: var(--tw-fs-sm); min-height: 1.4em; }
.hb-msg.is-bad { color: var(--tw-coral); }
.hb-dice { display: flex; justify-content: center; align-items: center; gap: calc(28 * var(--tw-u)); margin: var(--tw-4) 0 var(--tw-2); }
.hb-die-wrap { text-align: center; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); letter-spacing: 0.1em; text-transform: uppercase; }
.hb-die { width: calc(64 * var(--tw-u)); height: calc(64 * var(--tw-u)); margin: 0 auto var(--tw-2); border-radius: calc(12 * var(--tw-u)); background: #f3ead8; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.35);
	display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); padding: calc(8 * var(--tw-u)); box-sizing: border-box; }
.hb-die i { width: calc(11 * var(--tw-u)); height: calc(11 * var(--tw-u)); margin: auto; border-radius: 50%; background: #2a2622; opacity: 0; }
.hb-die i.on { opacity: 1; }
.hb-die.is-rolling { animation: hb-shake 0.45s ease-out; }
@keyframes hb-shake { 0% { transform: rotate(0) } 25% { transform: rotate(-14deg) translateY(-6px) } 55% { transform: rotate(10deg) } 100% { transform: rotate(0) } }
.hb-verdict { text-align: center; color: var(--tw-ink); font-size: var(--tw-fs-md); min-height: 1.5em; }
.hb-verdict small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); margin-top: 2px; }
.hb-center { display: flex; justify-content: center; margin: var(--tw-3) 0; }
`;

let cssInstalled = false;
export const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );
export const money = ( n ) => '$' + String( Math.round( Math.abs( n ) ) ).replace( /\B(?=(\d{3})+(?!\d))/g, ',' );
export const clockText = ( h ) => {

	const hh = ( ( h % 24 ) + 24 ) % 24;
	return `${ String( Math.floor( hh ) ).padStart( 2, '0' ) }:${ String( Math.floor( ( hh % 1 ) * 60 ) ).padStart( 2, '0' ) }`;

};

// which pips show for a die face (3 x 3 grid, row by row)
export const PIPS = { 1: [ 4 ], 2: [ 0, 8 ], 3: [ 0, 4, 8 ], 4: [ 0, 2, 6, 8 ], 5: [ 0, 2, 4, 6, 8 ], 6: [ 0, 2, 3, 5, 6, 8 ] };
export function dieHTML( v, cls = '' ) {

	const on = new Set( PIPS[ v ] || [] );
	return `<div class="hb-die ${ cls }">${ Array.from( { length: 9 }, ( _, i ) => `<i class="${ on.has( i ) ? 'on' : '' }"></i>` ).join( '' ) }</div>`;

}

export class GlassPanel {

	constructor( app ) {

		this.app = app;
		this.el = null;
		this.isOpen = false;
		this.onClose = null;
		this._keys = ( e ) => {

			if ( e.code === 'Escape' && this.isOpen ) this.close( true );

		};

	}

	_ensure() {

		if ( this.el ) return true;
		if ( typeof document === 'undefined' ) return false;
		const ui = this.app && this.app.ui && this.app.ui.ui;
		const host = ui ? ui.hud || ui.root : null;
		if ( ! host ) return false;
		if ( ! cssInstalled ) {

			const style = document.createElement( 'style' );
			style.textContent = CSS;
			document.head.append( style );
			cssInstalled = true;

		}

		this.el = document.createElement( 'div' );
		this.el.className = 'hb-panel tw-glass tw-interactive';
		this.el.addEventListener( 'click', ( e ) => {

			const b = e.target.closest( '[data-act]' );
			if ( ! b || b.disabled ) return;
			if ( b.dataset.act === 'close' ) { this.close( true ); return; }
			try { this.onClick( b.dataset.act, b ); } catch ( err ) { console.warn( 'panel action failed', err ); }
			this.refresh();

		} );
		host.append( this.el );
		return true;

	}

	open() {

		this.isOpen = true; // logical state even without a DOM (tests)
		if ( ! this._ensure() ) return true;
		this.refresh();
		this.el.classList.add( 'is-open' );
		try {

			if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock();

		} catch ( e ) { /* ignore */ }

		document.addEventListener( 'keydown', this._keys, true );
		return true;

	}

	close( byUser = false ) {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		if ( this.el ) this.el.classList.remove( 'is-open' );
		if ( typeof document !== 'undefined' ) document.removeEventListener( 'keydown', this._keys, true );
		if ( byUser && this.onClose ) this.onClose();

	}

	refresh() {

		if ( ! this.el || ! this.isOpen ) return;
		const html = this.render();
		if ( html !== this._last ) {

			this.el.innerHTML = html;
			this._last = html;

		}

	}

	render() {

		return '';

	}

	onClick() {}

	dispose() {

		this.close();
		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

}
