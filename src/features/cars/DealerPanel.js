// The car dealer's window (E at Meridian's showroom): the cars for sale with their prices, your cars (where they stand,
// their condition: repair, sell), and the ferry note (cars stay in Meridian until another island has roads). A glass
// panel in the HUD's look (the --tw-* tokens of ui/ui.css), built the first time it opens; Escape or Close shuts it.
// Everything comes from cars.dealerView(); the buttons call cars.buy( kind ) / repair( id ) / sell( id ) / ship( id, to ).

const CSS = /* css */`
.car-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); width: min(calc(480 * var(--tw-u, 1px)), calc(100vw - 32px));
	max-height: calc(100vh - 32px); overflow-y: auto; padding: 16px 20px; border-radius: 14px; font: 500 14px var(--tw-font, sans-serif); color: var(--tw-ink, #eef);
	opacity: 0; pointer-events: none; transition: opacity .18s, transform .25s; z-index: 6; }
.car-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.tw-root.is-photo .car-panel { display: none; }
.car-panel h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
.car-panel .car-sub { margin: 0 0 10px; color: var(--tw-ink-3, #aab); font-size: 12px; }
.car-panel .car-h3 { margin: 12px 0 6px; font-size: 12px; color: var(--tw-ink-3, #aab); text-transform: uppercase; letter-spacing: .08em; }
.car-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin-bottom: 6px; border-radius: 10px; background: var(--tw-fill, rgba(255,255,255,.06)); border: 1px solid var(--tw-line, rgba(255,255,255,.1)); }
.car-row div { flex: 1; min-width: 0; }
.car-row b { display: block; font-weight: 600; }
.car-row span { color: var(--tw-ink-3, #aab); font-size: 12px; }
.car-btn { font: 600 13px var(--tw-font, sans-serif); color: var(--tw-ink, #eef); background: var(--tw-fill-2, rgba(255,255,255,.12)); border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer; white-space: nowrap; }
.car-btn[disabled] { opacity: .35; cursor: default; }
.car-msg { min-height: 1.4em; margin-top: 6px; color: var(--tw-ink-3, #aab); font-size: 12px; }
.car-msg.is-bad { color: var(--tw-coral, #f88); }
`;

let cssInstalled = false;
const money = ( n ) => '$' + String( Math.round( n ) ).replace( /\B(?=(\d{3})+(?!\d))/g, ',' );

export class DealerPanel {

	constructor( cars ) {

		this.cars = cars;
		this.el = null;
		this.isOpen = false;
		this.msg = null;
		this._keys = ( e ) => { if ( e.code === 'Escape' && this.isOpen ) this.close(); };

	}

	_ensure() {

		if ( this.el || typeof document === 'undefined' ) return !! this.el;
		if ( ! cssInstalled ) {

			const st = document.createElement( 'style' );
			st.textContent = CSS;
			document.head.appendChild( st );
			cssInstalled = true;

		}

		const el = document.createElement( 'div' );
		el.className = 'car-panel tw-glass';
		el.addEventListener( 'click', ( e ) => this._click( e ) );
		( document.querySelector( '.tw-root' ) || document.body ).appendChild( el );
		this.el = el;
		return true;

	}

	open() {

		if ( ! this._ensure() ) { this.isOpen = true; return; }
		this.isOpen = true;
		this.msg = null;
		this.render();
		this.el.classList.add( 'is-open' );
		window.addEventListener( 'keydown', this._keys );
		if ( document.exitPointerLock ) try { document.exitPointerLock(); } catch ( e ) { /* not locked */ }

	}

	close() {

		this.isOpen = false;
		if ( ! this.el ) return;
		this.el.classList.remove( 'is-open' );
		window.removeEventListener( 'keydown', this._keys );

	}

	_click( e ) {

		const b = e.target.closest( 'button' );
		if ( ! b || b.disabled ) return;
		const act = b.dataset.act, arg = b.dataset.arg;
		let r = null;
		if ( act === 'close' ) return this.close();
		if ( act === 'buy' ) r = this.cars.buy( arg );
		else if ( act === 'repair' ) r = this.cars.repair( arg );
		else if ( act === 'sell' ) r = this.cars.sell( arg );
		this.msg = r ? { text: r.text || '', bad: ! r.ok } : null;
		this.render();

	}

	render() {

		if ( ! this.el ) return;
		const v = this.cars.dealerView();
		const sale = v.sale.map( ( s ) => `<div class="car-row"><div><b>${ s.name }</b><span>${ s.note }</span></div><button class="car-btn" data-act="buy" data-arg="${ s.kind }" ${ s.canBuy ? '' : 'disabled' }>${ s.price ? money( s.price ) : 'Free' }</button></div>` ).join( '' );
		const own = v.owned.length ? v.owned.map( ( o ) => `<div class="car-row"><div><b>${ o.name }</b><span>${ o.where } · ${ o.condition }</span></div>`
			+ `<button class="car-btn" data-act="repair" data-arg="${ o.id }" ${ o.canRepair ? '' : 'disabled' }>Repair ${ o.repair ? money( o.repair ) : '' }</button>`
			+ `<button class="car-btn" data-act="sell" data-arg="${ o.id }" ${ o.canSell ? '' : 'disabled' }>Sell ${ money( o.value ) }</button></div>` ).join( '' ) : '<p class="car-sub">No cars yet.</p>';
		this.el.innerHTML = `<h2>Meridian Motors</h2><p class="car-sub">Money ${ money( v.money ) }${ v.free ? ' · sandbox: free' : '' }. New cars wait at the kerb outside.</p>
			<div class="car-h3">For sale</div>${ sale }<div class="car-h3">Your cars</div>${ own }
			<p class="car-sub">${ v.ferry }</p><div class="car-msg ${ this.msg && this.msg.bad ? 'is-bad' : '' }">${ this.msg ? this.msg.text : '' }</div>
			<button class="car-btn" data-act="close">Close</button>`;

	}

	dispose() {

		this.close();
		if ( this.el && this.el.parentNode ) this.el.parentNode.removeChild( this.el );
		this.el = null;

	}

}
