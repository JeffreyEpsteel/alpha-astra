import { GOODS, PORTS } from '../trade/goods.js';

// The customs window: a small glass card in the HUD panels' look (the --tw-* tokens, .tw-glass) that appears when
// the customs launch comes alongside with contraband aboard. Three buttons: submit, bribe, dump. Built lazily the
// first time there is a HUD to put it in; headless (tests) it stays a plain object and customs.resolve() decides.

const CSS = /* css */`
.cu-panel { position: absolute; left: 50%; top: 22%; transform: translate(-50%, -8px); width: min(calc(420 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge)));
	padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); z-index: 7; }
.cu-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
.tw-root.is-photo .cu-panel { display: none; }
.cu-panel h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.cu-panel p { margin: 0 0 var(--tw-2); color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.5; }
.cu-panel p b { color: var(--tw-sun); font-weight: 600; }
.cu-acts { display: grid; gap: var(--tw-2); margin-top: var(--tw-3); }
.cu-acts button { text-align: left; font: 600 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); background: var(--tw-fill); border: 1px solid var(--tw-line); border-radius: var(--tw-r-md); padding: var(--tw-2) var(--tw-3); cursor: pointer; }
.cu-acts button:hover:not([disabled]) { background: var(--tw-fill-2); }
.cu-acts button[disabled] { opacity: 0.35; cursor: default; }
.cu-acts small { display: block; font-weight: 500; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); }
.cu-timer { height: 3px; border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; margin-top: var(--tw-3); }
.cu-timer > span { display: block; height: 100%; background: var(--tw-coral); width: 100%; }
`;

let cssInstalled = false;
const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );

export class CustomsPanel {

	constructor( customs ) {

		this.customs = customs;
		this.el = null;
		this.isOpen = false;
		this._raf = 0;

	}

	_ensure() {

		if ( this.el ) return true;
		if ( typeof document === 'undefined' ) return false;
		const app = this.customs.app;
		const ui = app && app.ui && app.ui.ui;
		const host = ui ? ui.hud || ui.root : null;
		if ( ! host ) return false;
		if ( ! cssInstalled ) {

			const style = document.createElement( 'style' );
			style.textContent = CSS;
			document.head.append( style );
			cssInstalled = true;

		}

		this.el = document.createElement( 'div' );
		this.el.className = 'cu-panel tw-glass tw-interactive';
		this.el.addEventListener( 'click', ( e ) => {

			const b = e.target && e.target.closest ? e.target.closest( '[data-choice]' ) : null;
			if ( b && ! b.disabled ) this.customs.resolve( b.dataset.choice );

		} );
		host.append( this.el );
		return true;

	}

	open( p ) {

		// headless: the inspection stays pending until resolve() (or the timeout in update)
		this.isOpen = true;
		if ( ! this._ensure() ) return false;
		const s = this.customs.state;
		const t = this.customs.trade;
		const purse = s && ! s.free ? Math.floor( s.money ) : Infinity;
		const hides = t && t.smuggler ? t.smuggler.hidden() : 0;
		const list = p.goods.map( ( h ) => `${ h.qty } ${ esc( GOODS[ h.good ].name.toLowerCase() ) }` ).join( ', ' );
		this.el.innerHTML = `
			<h2>Customs, ${ esc( PORTS[ p.port ].name ) }</h2>
			<p>The customs launch comes alongside. Aboard you carry <b>${ list }</b>, contraband here${ hides ? `; your compartment hides ${ hides } crates` : '' }.</p>
			<div class="cu-acts">
				<button data-choice="submit">Let them search<small>${ hides ? 'They may miss the compartment' : 'They will find it' }: seizure and a fine of about $${ Math.round( p.value * 0.5 + 25 ) }</small></button>
				<button data-choice="bribe" ${ purse < p.bribe ? 'disabled' : '' }>Offer $${ p.bribe }<small>Often taken, more so at night; refused, the fine is half again as big</small></button>
				<button data-choice="dump">Dump it overboard<small>Lose the cargo, keep your name clean</small></button>
			</div>
			<div class="cu-timer"><span></span></div>`;
		this.el.classList.add( 'is-open' );
		try { if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock(); } catch ( e ) { /* ignore */ }
		const bar = this.el.querySelector( '.cu-timer > span' );
		const tick = () => {

			if ( ! this.isOpen ) return;
			const k = Math.max( 0, 1 - this.customs._wait / this.customs.decide );
			bar.style.width = `${ k * 100 }%`;
			this._raf = requestAnimationFrame( tick );

		};

		if ( typeof requestAnimationFrame === 'function' ) this._raf = requestAnimationFrame( tick );
		return true;

	}

	close() {

		this.isOpen = false;
		if ( this._raf && typeof cancelAnimationFrame === 'function' ) cancelAnimationFrame( this._raf );
		this._raf = 0;
		if ( this.el ) this.el.classList.remove( 'is-open' );

	}

	dispose() {

		this.close();
		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

}
