// The black market window: a small glass card in the HUD panels' look (the --tw-* tokens, .tw-glass, like the customs card),
// opened with E at the fence's table on Blackwater. One button per row of BlackMarket.rows(); clicking runs the deal and the
// card redraws. Built lazily the first time there is a HUD to put it in; headless (tests) it stays a plain object.
//
//   const panel = new MarketPanel( stronghold );   panel.open() / close() / refresh()   panel.isOpen

const CSS = /* css */`
.bm-panel { position: absolute; right: var(--tw-edge); top: 18%; width: min(calc(380 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge)));
	padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease); z-index: 7; max-height: 64vh; overflow: auto; }
.bm-panel.is-open { opacity: 1; pointer-events: auto; }
.tw-root.is-photo .bm-panel { display: none; }
.bm-panel h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.bm-panel p { margin: 0 0 var(--tw-2); color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.5; }
.bm-rows { display: grid; gap: var(--tw-1); }
.bm-rows button { display: flex; justify-content: space-between; gap: var(--tw-2); text-align: left; font: 600 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink);
	background: var(--tw-fill); border: 1px solid var(--tw-line); border-radius: var(--tw-r-md); padding: var(--tw-2) var(--tw-3); cursor: pointer; }
.bm-rows button:hover:not([disabled]) { background: var(--tw-fill-2); }
.bm-rows button[disabled] { opacity: 0.35; cursor: default; }
.bm-rows small { color: var(--tw-ink-3); font-weight: 500; }
.bm-close { margin-top: var(--tw-3); font: 600 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink-2); background: none; border: 0; cursor: pointer; }
`;

let cssInstalled = false;
const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );
const WHY = { unwelcome: 'fly the black flag', alarm: 'not while the bell rings', closed: 'the fence has fled', empty: 'none aboard', owned: 'yours', money: 'not enough money' };

export class MarketPanel {

	constructor( stronghold ) {

		this.s = stronghold;
		this.el = null;
		this.isOpen = false;

	}

	_ensure() {

		if ( this.el ) return true;
		if ( typeof document === 'undefined' ) return false;
		const app = this.s.app, ui = app && app.ui && app.ui.ui;
		const host = ui ? ui.hud || ui.root : null;
		if ( ! host ) return false;
		if ( ! cssInstalled ) {

			const style = document.createElement( 'style' );
			style.textContent = CSS;
			document.head.append( style );
			cssInstalled = true;

		}

		this.el = document.createElement( 'div' );
		this.el.className = 'bm-panel tw-glass tw-interactive';
		this.el.addEventListener( 'click', ( e ) => {

			const b = e.target && e.target.closest ? e.target.closest( '[data-row]' ) : null;
			if ( b && ! b.disabled ) { this.s.marketAction( b.dataset.row ); this.refresh(); return; }
			if ( e.target && e.target.closest && e.target.closest( '.bm-close' ) ) this.close();

		} );
		host.append( this.el );
		return true;

	}

	open() {

		this.isOpen = true;
		if ( ! this._ensure() ) return;
		this.refresh();
		this.el.classList.add( 'is-open' );

	}

	refresh() {

		if ( ! this.el || ! this.isOpen ) return;
		const rows = this.s.marketRows();
		const btn = ( r ) => `<button data-row="${ esc( r.id ) }" ${ r.ok ? '' : 'disabled' }><span>${ esc( r.label ) }${ r.qty ? ` <small>x${ r.qty }</small>` : '' }${ ! r.ok && WHY[ r.why ] ? ` <small>· ${ esc( WHY[ r.why ] ) }</small>` : '' }</span><span>$${ r.price }</span></button>`;
		this.el.innerHTML = `<h2>The black market</h2><p>The fence pays well for what the harbour would seize, and asks no questions about where it came from.</p>
			<div class="bm-rows">${ rows.map( btn ).join( '' ) }</div><button class="bm-close">Close</button>`;

	}

	close() {

		this.isOpen = false;
		if ( this.el ) this.el.classList.remove( 'is-open' );

	}

	dispose() {

		this.close();
		if ( this.el && this.el.parentNode ) this.el.parentNode.removeChild( this.el );
		this.el = null;

	}

}
