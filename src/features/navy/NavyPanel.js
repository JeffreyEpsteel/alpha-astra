// The navy office window (wave 19B): a small glass card in the HUD panels' look (the --tw-* tokens, .tw-glass), opened with E at
// the naval jetty's office or the Tidemark harbourmaster's claim: your standing, the bounties owed (claim), a fine owed (pay),
// the chandler (better cannon by standing, chain shot and powder cheaper the better it is) and the forecast at sea. The press
// gang's "invitation" uses the same card with its two answers. Built lazily the first time there is a HUD to put it in; headless
// (tests) it stays a plain object and the navy's methods decide.

const CSS = /* css */`
.nv-panel { position: absolute; left: 50%; top: 16%; transform: translate(-50%, -8px); width: min(calc(440 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge)));
	padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); z-index: 7; }
.nv-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
.tw-root.is-photo .nv-panel { display: none; }
.nv-panel h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.nv-panel p { margin: 0 0 var(--tw-2); color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.5; }
.nv-panel p b { color: var(--tw-sun); font-weight: 600; }
.nv-acts { display: grid; gap: var(--tw-2); margin-top: var(--tw-3); }
.nv-acts button { text-align: left; font: 600 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); background: var(--tw-fill); border: 1px solid var(--tw-line); border-radius: var(--tw-r-md); padding: var(--tw-2) var(--tw-3); cursor: pointer; }
.nv-acts button:hover:not([disabled]) { background: var(--tw-fill-2); }
.nv-acts button[disabled] { opacity: 0.35; cursor: default; }
.nv-acts small { display: block; font-weight: 500; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); }
.nv-close { position: absolute; right: var(--tw-3); top: var(--tw-3); background: none; border: 0; color: var(--tw-ink-3); font-size: 18px; cursor: pointer; }
`;

let cssInstalled = false;
const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );

export class NavyPanel {

	constructor( navy ) {

		this.navy = navy;
		this.el = null;
		this.isOpen = false;
		this.mode = null; // 'office' | 'press'

	}

	_ensure() {

		if ( this.el ) return true;
		if ( typeof document === 'undefined' || ! document.createElement ) return false;
		const app = this.navy.app;
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
		this.el.className = 'nv-panel tw-glass tw-interactive';
		this.el.addEventListener( 'click', ( e ) => {

			const b = e.target && e.target.closest ? e.target.closest( '[data-nv]' ) : null;
			if ( ! b || b.disabled ) return;
			const act = b.dataset.nv;
			if ( act === 'close' ) this.close();
			else if ( act === 'claim' ) this.navy.claim();
			else if ( act === 'fine' ) this.navy.payFine();
			else if ( act === 'refuse' || act === 'sign' ) this.navy.resolvePress( act );
			else if ( act.startsWith( 'buy:' ) ) this.navy.buy( act.slice( 4 ) );
			if ( this.isOpen ) this.render();

		} );
		host.append( this.el );
		return true;

	}

	open( mode = 'office' ) {

		this.mode = mode;
		this.isOpen = true;
		if ( ! this._ensure() ) return false;
		this.render();
		this.el.classList.add( 'is-open' );
		try { if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock(); } catch ( e ) { /* ignore */ }
		return true;

	}

	render() {

		if ( ! this.el ) return;
		const n = this.navy, v = n.view();
		if ( this.mode === 'press' && n.press ) {

			this.el.innerHTML = `
				<h2>The press gang</h2>
				<p>Four sailors and a bosun with a cudgel "invite" you to sign on for the King's service. Your navy standing is <b>${ esc( v.standingName ) }</b>; they are very keen.</p>
				<div class="nv-acts">
					<button data-nv="sign">Sign on<small>Scrub the frigate's deck till sundown; the navy thinks better of you</small></button>
					<button data-nv="refuse">Refuse politely<small>A fine of $${ n.press.fine } for wasting their time</small></button>
				</div>`;
			return;

		}

		const rows = n.chandlerRows().map( ( r ) => `<button data-nv="buy:${ r.id }" ${ r.ok ? '' : 'disabled' }>${ esc( r.label ) } · $${ r.price }<small>${ esc( r.note ) }</small></button>` ).join( '' );
		this.el.innerHTML = `
			<button class="nv-close" data-nv="close" aria-label="Close">×</button>
			<h2>Navy office, Tidemark</h2>
			<p>Standing: <b>${ esc( v.standingName ) }</b> (${ v.standing })${ v.wanted ? ' · <b>wanted</b>' : '' }</p>
			<p>${ esc( v.forecast ) }</p>
			<div class="nv-acts">
				<button data-nv="claim" ${ v.owed > 0 ? '' : 'disabled' }>Claim navy bounties · $${ v.owed }<small>${ v.owedCount } pirate${ v.owedCount === 1 ? '' : 's' } sunk for the Crown</small></button>
				${ v.fineOwed > 0 ? `<button data-nv="fine">Pay the fine · $${ v.fineOwed }<small>Unpaid fines keep your name on the list</small></button>` : '' }
				${ rows }
			</div>`;

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
