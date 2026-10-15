import { GOODS, GOOD_IDS, PORTS } from './goods.js';

// The trade window: a glass panel in the look of the game's HUD panels (gm-panel: the --tw-* tokens of
// ui/ui.css, .tw-glass), opened at a market stall with E. Tabs: Market (every good with the stall's buy and sell
// price, a two-day sparkline, the other port's last known price with the margin, what the hold carries, and
// buy / sell buttons for 1, 5 and max / all, and a row of ports to compare with), Contracts (hauling offers, the
// licence, consignments aboard), Credit (merchant standing, the lender, loans), Costs (bait, wages, upkeep), Ledger
// (profit, trips, best trade, routes) and News (market events, rival voyages, the smuggler's rumour). Opened at the
// smuggler's spot the same window shows his Contraband tab instead. The hold bar and the projected profit of the
// cargo stay below every tab.
//
// The DOM is built lazily, the first time the window opens with a HUD to put it in (app.ui.ui.hud), and the market
// rows are built once and updated in place so a click never lands on a button that was just replaced.
// Everything it shows comes from trade.view( port ); the buttons call trade.buy / trade.sell.
//
// Wave 15B, legible first: the Market tab opens on the harbourmaster's board (the five best loads from here, and what
// the fish hall wants today), then the goods of this port only (what it makes, what it wants, what you carry, what
// moved) with a chip for all goods. Each row reads: made here / wanted here, a trend arrow over the day and the news
// behind it, and the best route (where to sell what you hold, else where it sells best, else where to bring it from:
// margin per crate, hours at your boat's speed, pirate lanes). Costs adds harbour dues, insurance and the Tidemark
// warehouse; the Ledger adds those costs and the fish halls.

const CSS = /* css */`
.tr-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); width: min(calc(720 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge))); max-height: 84vh;
	display: flex; flex-direction: column; padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); z-index: 6; }
.tr-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.tw-root.is-photo .tr-panel { display: none; }
.tr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--tw-3); }
.tr-head h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.tr-sub { margin: 0; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.tr-sub b { color: var(--tw-sun); font-family: var(--tw-mono); font-weight: 600; }
.tr-btn { font: 600 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); background: var(--tw-fill-2); border: 0; border-radius: 999px; padding: var(--tw-2) var(--tw-4); cursor: pointer; white-space: nowrap; }
.tr-btn:hover { background: var(--tw-line-2); }
.tr-tabs { display: flex; gap: var(--tw-1); margin: var(--tw-3) 0; padding: 3px; border-radius: 999px; background: var(--tw-fill); }
.tr-tab { flex: 1; font: 600 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink-2); background: none; border: 0; border-radius: 999px; padding: calc(5 * var(--tw-u)) var(--tw-3); cursor: pointer; transition: background var(--tw-fast), color var(--tw-fast); }
.tr-tab:hover { color: var(--tw-ink); }
.tr-tab.is-on { background: var(--tw-fill-2); color: var(--tw-ink); box-shadow: inset 0 0 0 1px var(--tw-line-2); }
.tr-body { overflow: auto; min-height: 0; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2); }
.tr-cols, .tr-row { display: grid; grid-template-columns: minmax(0, 1.3fr) calc(60 * var(--tw-u)) calc(50 * var(--tw-u)) calc(50 * var(--tw-u)) minmax(0, 1.25fr) calc(62 * var(--tw-u)) auto; gap: var(--tw-2); align-items: center; }
.tr-cols { padding: 0 0 var(--tw-1); color: var(--tw-ink-3); font-size: var(--tw-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 1px solid var(--tw-line); }
.tr-cols span:nth-child(n+3) { text-align: right; }
.tr-cols span:nth-child(2) { text-align: center; }
.tr-row { padding: calc(6 * var(--tw-u)) 0; border-bottom: 1px solid var(--tw-line); }
.tr-row.is-event { background: linear-gradient(90deg, rgba(var(--tw-sun-rgb), 0.07), transparent 70%); }
.tr-name { display: flex; align-items: center; gap: var(--tw-2); min-width: 0; }
.tr-name > div { min-width: 0; }
.tr-name b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-name small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); line-height: 1.3; }
.tr-name em { font-style: normal; font-weight: 600; color: var(--tw-sun); }
.tr-sw { flex: none; width: calc(10 * var(--tw-u)); height: calc(26 * var(--tw-u)); border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35); }
.tr-spark { width: 100%; height: calc(22 * var(--tw-u)); overflow: visible; }
.tr-spark polyline { fill: none; stroke: var(--tw-aqua); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.tr-spark line { stroke: var(--tw-ink-4); stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
.tr-spark circle { fill: var(--tw-sun); }
.tr-num { text-align: right; min-width: 0; }
.tr-num b { display: block; font: 600 var(--tw-fs-md) var(--tw-mono); color: var(--tw-ink); white-space: nowrap; }
.tr-num small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-num small.is-cheap { color: var(--tw-aqua); }
.tr-num small.is-dear { color: var(--tw-sun); }
.tr-num small.is-up { color: var(--tw-aqua); }
.tr-num small.is-down { color: var(--tw-coral); }
.tr-num.is-stale b { color: var(--tw-ink-3); }
.tr-act { display: flex; gap: var(--tw-2); justify-content: flex-end; }
.tr-grp { display: inline-flex; gap: 2px; }
.tr-grp button { font: 600 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink); background: var(--tw-fill); border: 1px solid var(--tw-line); padding: 2px calc(7 * var(--tw-u)); cursor: pointer; min-width: calc(26 * var(--tw-u)); }
.tr-grp button:first-child { border-radius: 999px 0 0 999px; }
.tr-grp button:last-child { border-radius: 0 999px 999px 0; }
.tr-grp.is-buy button { color: var(--tw-aqua); }
.tr-grp.is-sell button { color: var(--tw-sun); }
.tr-grp button:hover:not([disabled]) { background: var(--tw-fill-2); }
.tr-grp button[disabled] { opacity: 0.32; cursor: default; }
.tr-tick { color: var(--tw-ink-2); font-size: var(--tw-fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-tick b { color: var(--tw-sun); font-weight: 600; margin-right: var(--tw-2); font-size: var(--tw-fs-xs); letter-spacing: 0.12em; text-transform: uppercase; }
.tr-news { margin: var(--tw-3) 0 0; padding: 0; list-style: none; color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.5; }
.tr-news li { display: flex; gap: var(--tw-2); padding: 2px 0; }
.tr-news time { flex: none; width: calc(54 * var(--tw-u)); color: var(--tw-ink-3); font-family: var(--tw-mono); font-size: var(--tw-fs-xs); padding-top: 1px; }
.tr-news li.is-active { color: var(--tw-ink); }
.tr-news li.is-active time { color: var(--tw-sun); }
.tr-body h3 { margin: var(--tw-3) 0 var(--tw-1); font-size: var(--tw-fs-xs); font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--tw-ink-3); }
.tr-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--tw-2); margin: var(--tw-1) 0 var(--tw-2); }
.tr-stats div { padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); background: var(--tw-fill); border: 1px solid var(--tw-line); }
.tr-stats span { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; }
.tr-stats b { font: 600 calc(15 * var(--tw-u)) var(--tw-mono); }
.tr-pos { color: var(--tw-aqua); }
.tr-neg { color: var(--tw-coral); }
.tr-table { width: 100%; border-collapse: collapse; font-size: var(--tw-fs-sm); }
.tr-table th { text-align: right; color: var(--tw-ink-3); font-weight: 600; font-size: var(--tw-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 0 var(--tw-1); border-bottom: 1px solid var(--tw-line); }
.tr-table td { text-align: right; font-family: var(--tw-mono); padding: calc(5 * var(--tw-u)) 0; border-bottom: 1px solid var(--tw-line); }
.tr-table th:first-child, .tr-table td:first-child { text-align: left; font-family: var(--tw-font); }
.tr-empty { color: var(--tw-ink-3); padding: var(--tw-3) 0; font-size: var(--tw-fs-sm); }
.tr-foot { margin-top: var(--tw-3); padding-top: var(--tw-3); border-top: 1px solid var(--tw-line); display: grid; gap: var(--tw-1); }
.tr-cap { display: flex; align-items: center; gap: var(--tw-3); color: var(--tw-ink-2); }
.tr-capbar { flex: 1; max-width: calc(220 * var(--tw-u)); height: calc(6 * var(--tw-u)); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.tr-capbar > span { display: block; height: 100%; width: 0; background: var(--tw-aqua); border-radius: inherit; transition: width var(--tw-med) var(--tw-ease); }
.tr-capbar.is-full > span { background: var(--tw-coral); }
.tr-cap b { font-family: var(--tw-mono); font-weight: 600; color: var(--tw-ink); }
.tr-cap small { color: var(--tw-ink-3); }
.tr-proj { color: var(--tw-ink-2); font-size: var(--tw-fs-sm); min-height: 1.4em; }
.tr-warn { color: var(--tw-sun); font-size: var(--tw-fs-sm); }
.tr-msg { color: var(--tw-ink-3); font-size: var(--tw-fs-sm); min-height: 1.4em; }
.tr-msg.is-bad { color: var(--tw-coral); }
.tr-num small.is-contraband, .tr-bad { color: var(--tw-coral); }
.tr-cmp { display: flex; flex-wrap: wrap; gap: var(--tw-1); align-items: center; margin: 0 0 var(--tw-2); color: var(--tw-ink-3); font-size: var(--tw-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; }
.tr-cmp button { font: 600 var(--tw-fs-sm) var(--tw-font); letter-spacing: 0; text-transform: none; color: var(--tw-ink-2); background: var(--tw-fill); border: 1px solid var(--tw-line); border-radius: 999px; padding: 1px calc(9 * var(--tw-u)); cursor: pointer; }
.tr-cmp button.is-on { color: var(--tw-ink); background: var(--tw-fill-2); border-color: var(--tw-line-2); }
.tr-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--tw-2) var(--tw-3); align-items: center; padding: calc(7 * var(--tw-u)) 0; border-bottom: 1px solid var(--tw-line); }
.tr-card b { font-weight: 600; }
.tr-card small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); line-height: 1.4; }
.tr-card .tr-act { gap: var(--tw-1); flex-wrap: wrap; }
.tr-act .tr-btn { padding: 2px var(--tw-3); font-size: var(--tw-fs-sm); }
.tr-act .tr-btn[disabled] { opacity: 0.35; cursor: default; }
.tr-row.is-hidden { display: none; }
.tr-name i.tr-tagm, .tr-name i.tr-tagw, .tr-name i.tr-tagl { font-style: normal; font-weight: 700; font-size: var(--tw-fs-xs); letter-spacing: 0.06em; text-transform: uppercase; margin-right: 4px; }
.tr-name i.tr-tagm { color: var(--tw-aqua); }
.tr-name i.tr-tagw { color: var(--tw-sun); }
.tr-name i.tr-tagl { color: var(--tw-coral); }
.tr-why { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-trend { font: 700 var(--tw-fs-sm) var(--tw-mono); text-align: center; display: block; line-height: 1; }
.tr-trend.is-up { color: var(--tw-aqua); }
.tr-trend.is-down { color: var(--tw-coral); }
.tr-trend.is-flat { color: var(--tw-ink-4); }
.tr-board { margin: 0 0 var(--tw-2); padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); background: var(--tw-fill); border: 1px solid var(--tw-line); font-size: var(--tw-fs-sm); }
.tr-board h4 { margin: 0 0 var(--tw-1); font-size: var(--tw-fs-xs); font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tw-ink-3); display: flex; justify-content: space-between; gap: var(--tw-2); }
.tr-board h4 span { letter-spacing: 0; text-transform: none; font-weight: 500; }
.tr-board ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 1px; }
.tr-board li { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: var(--tw-2); align-items: baseline; }
.tr-board li b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-board li span { color: var(--tw-ink-3); font-size: var(--tw-fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-board li em { font: 600 var(--tw-fs-sm) var(--tw-mono); font-style: normal; color: var(--tw-aqua); text-align: right; }
.tr-board p { margin: var(--tw-1) 0 0; color: var(--tw-ink-2); font-size: var(--tw-fs-xs); }
.tr-board .is-risk { color: var(--tw-coral); }
@media (max-width: 760px) {
	.tr-cols, .tr-row { grid-template-columns: minmax(0, 1.4fr) calc(46 * var(--tw-u)) calc(46 * var(--tw-u)) minmax(0, 1fr) calc(34 * var(--tw-u)) auto; }
	.tr-spark, .tr-cols span:nth-child(2) { display: none; }
}
`;

const TABS = [ [ 'market', 'Market' ], [ 'contracts', 'Contracts' ], [ 'credit', 'Credit' ], [ 'costs', 'Costs' ], [ 'ledger', 'Ledger' ], [ 'news', 'News' ] ];
const DEN_TABS = [ [ 'den', 'Contraband' ], [ 'news', 'Word' ] ];
const portName = ( id ) => ( PORTS[ id ] ? PORTS[ id ].name : id );
let cssInstalled = false;

const group = ( n ) => String( Math.round( Math.abs( n ) ) ).replace( /\B(?=(\d{3})+(?!\d))/g, ',' );
const money = ( n ) => ( n < 0 ? '-$' : '$' ) + group( n );
const signed = ( n ) => ( n < 0 ? '-$' : '+$' ) + group( n );
const price = ( p ) => ( p < 20 ? '$' + p.toFixed( 1 ) : '$' + group( p ) );
const hours = ( h ) => ( h < 1 ? 'just now' : h < 48 ? `${ Math.round( h ) } h ago` : `${ Math.round( h / 24 ) } d ago` );
const left = ( h ) => ( h <= 0 ? 'due now' : h < 48 ? `${ Math.max( 1, Math.round( h ) ) } h left` : `${ Math.round( h / 24 ) } d left` );
const clock = ( h ) => {

	const m = Math.floor( ( h % 1 ) * 60 );
	return `${ String( Math.floor( h ) ).padStart( 2, '0' ) }:${ String( m ).padStart( 2, '0' ) }`;

};

// wave 16C: the window writes the DOM only on a change (DomWrites style). refresh() runs twice a second while it is
// open and rewrote ~20 rows of ~20 fields each time, nearly all to the value they had (a same-value textContent or innerHTML
// still replaces the nodes and relayouts). The last value is kept on the element: these are the only writers of those fields.
//   put( el, 'text' | 'html', v ) (one cache for both: an element may switch)   prop( el, k, v )   css( el, k, v )   attr( el, k, v )   tog( el, cls, on )
function put( el, kind, v ) {

	const k = ( kind === 'html' ? 'h' : 't' ) + v;
	if ( el._trPut === k ) return;
	el._trPut = k;
	if ( kind === 'html' ) el.innerHTML = v;
	else el.textContent = v;

}

function prop( el, k, v ) {

	const c = el._trProp || ( el._trProp = {} );
	if ( c[ k ] === v ) return;
	c[ k ] = v;
	el[ k ] = v;

}

function attr( el, k, v ) {

	const c = el._trAttr || ( el._trAttr = {} );
	if ( c[ k ] === v ) return;
	c[ k ] = v;
	el.setAttribute( k, v );

}

function css( el, k, v ) {

	const c = el._trCss || ( el._trCss = {} );
	if ( c[ k ] === v ) return;
	c[ k ] = v;
	el.style[ k ] = v;

}

function tog( el, cls, on ) {

	on = !! on;
	const c = el._trCls || ( el._trCls = {} );
	if ( c[ cls ] === on ) return;
	c[ cls ] = on;
	el.classList.toggle( cls, on );

}

const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );

export class TradePanel {

	constructor( trade ) {

		this.trade = trade;
		this.el = null;
		this.port = null;
		this.kind = 'market';
		this.tab = 'market';
		this.loanDays = 3;
		this.filter = 'port'; // the market rows: 'port' (this port's own goods, the hold, what moved) | 'hold' | 'all'
		this.isOpen = false;
		this.msg = null; // { text, bad, at }
		this._rows = {};
		this._cache = '';
		this._keys = ( e ) => {

			if ( e.code === 'Escape' && this.isOpen ) this.trade.close();

		};

	}

	_ensure() {

		if ( this.el ) return true;
		if ( typeof document === 'undefined' ) return false;
		const app = this.trade.app;
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
		this.el.className = 'tr-panel tw-glass tw-interactive';
		this.el.addEventListener( 'click', ( e ) => this._click( e ) );
		host.append( this.el );
		return true;

	}

	open( port, kind = 'market' ) {

		if ( ! this._ensure() ) return false;
		this.port = port;
		if ( kind !== this.kind ) this.tab = kind === 'smuggler' ? 'den' : 'market';
		this.kind = kind;
		this.isOpen = true;
		this.msg = null;
		this.build();
		this.refresh();
		this.el.classList.add( 'is-open' );
		try {

			if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock();

		} catch ( e ) { /* ignore */ }

		document.addEventListener( 'keydown', this._keys, true );
		return true;

	}

	close() {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		if ( this.el ) this.el.classList.remove( 'is-open' );
		if ( typeof document !== 'undefined' ) document.removeEventListener( 'keydown', this._keys, true );

	}

	dispose() {

		this.close();
		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

	// ---- structure

	build() {

		const el = this.el;
		el.innerHTML = `
			<div class="tr-head"><div><h2 data-f="title"></h2><p class="tr-sub" data-f="sub"></p></div><button class="tr-btn" data-act="close">Close (E)</button></div>
			<div class="tr-tabs">${ ( this.kind === 'smuggler' ? DEN_TABS : TABS ).map( ( [ id, name ] ) => `<button class="tr-tab${ id === this.tab ? ' is-on' : '' }" data-act="tab" data-tab="${ id }">${ name }</button>` ).join( '' ) }</div>
			<div class="tr-body" data-f="body"></div>
			<div class="tr-foot">
				<div class="tr-cap"><span>Hold</span><span class="tr-capbar" data-f="capbar"><span></span></span><b data-f="cap"></b><small data-f="kg"></small></div>
				<div class="tr-proj" data-f="proj"></div>
				<div class="tr-warn" data-f="warn"></div>
				<div class="tr-msg" data-f="msg"></div>
				<div class="tr-tick" data-f="tick"></div>
			</div>`;
		this._f = {};
		for ( const n of el.querySelectorAll( '[data-f]' ) ) this._f[ n.dataset.f ] = n;
		this._rows = {};
		this._cache = '';
		if ( this.tab === 'market' ) this.buildMarket();

	}

	buildMarket() {

		const body = this._f.body;
		body.innerHTML = `
			<div class="tr-board" data-f="board"></div>
			<div class="tr-cmp" data-f="filter"></div>
			<div class="tr-cmp" data-f="cmp"></div>
			<div class="tr-cols"><span>Goods</span><span>Day</span><span>Buy</span><span>Sell</span><span data-f="othername">Best route</span><span>Hold</span><span style="text-align:right">Buy / sell</span></div>
			${ GOOD_IDS.map( ( g ) => `
			<div class="tr-row" data-good="${ g }">
				<div class="tr-name"><i class="tr-sw" style="background:${ GOODS[ g ].color }"></i><div><b>${ GOODS[ g ].name }</b><small data-f="meta"></small><span class="tr-why" data-f="why"></span></div></div>
				<div><svg class="tr-spark" viewBox="0 0 64 22" preserveAspectRatio="none"><line data-f="eq" x1="0" x2="64" y1="11" y2="11"></line><polyline data-f="line" points=""></polyline><circle data-f="dot" r="2.2" cx="64" cy="11"></circle></svg><span class="tr-trend" data-f="trend"></span></div>
				<div class="tr-num"><b data-f="buy"></b><small data-f="tag"></small></div>
				<div class="tr-num"><b data-f="sell"></b><small data-f="cond"></small></div>
				<div class="tr-num" data-f="otherbox"><b data-f="other"></b><small data-f="note"></small><small data-f="age"></small></div>
				<div class="tr-num"><b data-f="held"></b><small data-f="heldv"></small></div>
				<div class="tr-act">
					<span class="tr-grp is-buy"><button data-act="buy" data-n="1" title="Buy one">+1</button><button data-act="buy" data-n="5" title="Buy five">+5</button><button data-act="buy" data-n="max" title="Buy as many as fit and you can pay for">Max</button></span>
					<span class="tr-grp is-sell"><button data-act="sell" data-n="1" title="Sell one">-1</button><button data-act="sell" data-n="5" title="Sell five">-5</button><button data-act="sell" data-n="all" title="Sell all of it">All</button></span>
				</div>
			</div>` ).join( '' ) }`;
		for ( const row of body.querySelectorAll( '.tr-row' ) ) {

			const f = {};
			for ( const n of row.querySelectorAll( '[data-f]' ) ) f[ n.dataset.f ] = n;
			f.el = row;
			f.buttons = [ ...row.querySelectorAll( 'button' ) ];
			this._rows[ row.dataset.good ] = f;

		}

		this._f.othername = body.querySelector( '[data-f="othername"]' );
		this._f.cmp = body.querySelector( '[data-f="cmp"]' );
		this._f.board = body.querySelector( '[data-f="board"]' );
		this._f.filter = body.querySelector( '[data-f="filter"]' );
		this._cmpKey = '';
		this._boardKey = '';
		this._filterKey = '';

	}

	// ---- values

	refresh() {

		if ( ! this.isOpen || ! this.el ) return;
		const t = this.trade;
		const v = t.view( this.port );
		const F = this._f;
		put( F.title, 'text', this.kind === 'smuggler' ? `${ t.smuggler.view( this.port ).name }, ${ v.name }` : v.title );
		put( F.sub, 'html', `Day ${ v.day } · ${ clock( v.hour ) } · Purse <b>${ v.sandbox ? 'free play' : money( v.money ) }</b> · Standing <b>${ Math.floor( v.standing ) }</b>${ v.sandbox ? ' · sandbox: purchases are free' : '' }` );
		put( F.cap, 'text', `${ v.used } / ${ v.capacity } crates` );
		put( F.kg, 'text', `${ Math.round( v.kg ) } kg${ v.boat ? '' : ' · on foot' }` );
		css( F.capbar.firstElementChild, 'width', `${ Math.min( 100, v.capacity ? v.used / v.capacity * 100 : 100 ) }%` );
		tog( F.capbar, 'is-full', v.used >= v.capacity );
		const p = v.projected;
		if ( p.has ) put( F.proj, 'html', `Cargo sold at ${ p.name } at the prices last seen: <b class="${ p.profit >= 0 ? 'tr-pos' : 'tr-neg' }">${ signed( p.profit ) }</b> (worth ${ money( p.value ) }, cost ${ money( p.cost ) }), voyage about ${ Math.max( 1, Math.round( v.voyage ) ) } h` );
		else if ( v.tip ) put( F.proj, 'html', `Hold empty. Best load here: <b class="tr-pos">${ esc( v.tip.name ) } x${ v.tip.room }</b>, about ${ signed( v.tip.gain ) } if sold at ${ v.otherName } at the prices last seen.` );
		else put( F.proj, 'text', 'Hold empty. Nothing here beats the prices at ' + v.otherName + ' right now.' );
		put( F.warn, 'text', v.warnings.join( ' · ' ) );
		if ( this.msg && performance.now() - this.msg.at > 6000 ) this.msg = null;
		put( F.msg, 'text', this.msg ? this.msg.text : v.sandbox ? 'Sandbox: buying costs nothing, selling still pays.' : '' );
		tog( F.msg, 'is-bad', this.msg && this.msg.bad );
		const n = v.news.find( ( x ) => x.active ) || v.news[ 0 ];
		put( F.tick, 'html', n ? `<b>${ n.active ? 'News' : 'Earlier' }</b>${ esc( n.text ) } (${ hours( n.age ) })` : '' );
		if ( this.tab === 'market' ) this.refreshMarket( v );
		else this.refreshText( v );

	}

	// which rows the filter shows
	shows( r ) {

		if ( this.filter === 'all' ) return true;
		if ( this.filter === 'hold' ) return r.held > 0;
		return r.held > 0 || r.made || r.wanted || !! r.event || ( r.trend && r.trend.dir !== 'flat' && r.legal );

	}

	boardHtml( v ) {

		const b = v.board || [];
		const fish = v.fish && v.fish.wantedName ? `<p>Fish hall: <b>${ esc( v.fish.wantedName ) }</b> wanted today (+${ Math.round( v.fish.bonus * 100 ) }%)${ v.fish.eats.length ? ` · the port likes ${ esc( v.fish.eats.join( ', ' ).toLowerCase() ) }` : '' }${ v.fish.iced ? ' · ice aboard keeps the catch fresh' : '' }</p>` : '';
		const known = v.identity && v.identity.signature.length ? `<span>${ esc( v.name ) } makes ${ esc( v.identity.signature.join( ', ' ).toLowerCase() ) }</span>` : '';
		const dues = v.dues && v.dues.fee ? `<p>Harbour dues here: ${ money( v.dues.fee ) } a docking</p>` : '';
		const rows = b.map( ( x ) => `<li title="${ esc( `Buy at ${ price( x.buy ) }, sells ${ x.rumour ? 'by rumour ' : '' }at ${ price( x.sell ) } in ${ x.toName }; ${ ( x.metres / 1000 ).toFixed( 1 ) } km` ) }"><b>${ esc( x.name ) } to ${ esc( x.toName ) }${ x.rumour ? ' ~' : '' }</b><span class="${ x.lanes ? 'is-risk' : '' }">${ Math.max( 1, Math.round( x.hours ) ) } h · ${ x.lanes ? x.risk : 'safe' } · up to ${ x.room }${ x.fine && v.licence < 1 && ! v.sandbox ? ' · licence' : '' }</span><em>${ signed( x.perCrate ) }/crate</em></li>` ).join( '' );
		return `<h4>Harbourmaster's board ${ known }</h4>${ rows ? `<ol>${ rows }</ol>` : '<div class="tr-empty">Nothing worth loading here at the prices you know.</div>' }${ fish }${ dues }`;

	}

	// the best-route cell: where the row's good is worth carrying
	routeCell( r ) {

		const hrs = ( x ) => `${ Math.max( 1, Math.round( x.hours ) ) } h${ x.lanes ? ' · ' + x.risk : '' }`;
		if ( ! r.legal && ! r.held ) return { b: '-', note: 'contraband here', age: '', cls: 'is-contraband' };
		const s = r.best;
		if ( r.held && s ) {

			if ( s.here ) return { b: 'Sell here', note: `${ signed( s.margin ) }/unit on cost`, age: '', cls: s.margin >= 0 ? 'is-up' : 'is-down' };
			return { b: `${ s.rumour ? '~' : '' }${ esc( s.name ) }`, note: `${ signed( s.margin ) }/unit on cost`, age: hrs( s ), cls: s.margin >= 0 ? 'is-up' : 'is-down' };

		}

		if ( s && ! s.here && s.margin > 0 ) return { b: `${ s.rumour ? '~' : '' }${ esc( s.name ) }`, note: `${ signed( s.perCrate ) }/crate`, age: hrs( s ), cls: 'is-up' };
		const src = r.source;
		if ( src && src.margin > 0 ) return { b: `from ${ src.rumour ? '~' : '' }${ esc( src.name ) }`, note: `${ signed( src.perCrate ) }/crate brought here`, age: hrs( src ), cls: 'is-dear' };
		return { b: '-', note: 'no margin anywhere', age: '', cls: '' };

	}

	refreshMarket( v ) {

		put( this._f.othername, 'text', 'Best route' );
		const bk = JSON.stringify( [ v.board, v.fish, v.dues, v.licence ] );
		if ( bk !== this._boardKey ) {

			this._boardKey = bk;
			this._f.board.innerHTML = this.boardHtml( v );

		}

		const fk = this.filter;
		if ( fk !== this._filterKey ) {

			this._filterKey = fk;
			this._f.filter.innerHTML = `<span>Show</span>${ [ [ 'port', `${ esc( v.name ) }'s goods` ], [ 'hold', 'In the hold' ], [ 'all', 'All goods' ] ].map( ( [ id, n ] ) => `<button data-act="filter" data-filter="${ id }" class="${ id === fk ? 'is-on' : '' }">${ n }</button>` ).join( '' ) }`;

		}

		const key = v.other + '|' + v.ports.map( ( p ) => p.id ).join();
		if ( key !== this._cmpKey ) {

			this._cmpKey = key;
			this._f.cmp.innerHTML = `<span>Projected at</span>${ v.ports.map( ( p ) => `<button data-act="cmp" data-port="${ p.id }" class="${ p.id === v.other ? 'is-on' : '' }" title="${ p.seen ? 'Prices you saw there' : 'Only rumours so far' }">${ esc( p.name ) }${ p.seen ? '' : ' ~' }</button>` ).join( '' ) }`;

		}

		for ( const r of v.rows ) {

			const f = this._rows[ r.id ];
			if ( ! f ) continue;
			tog( f.el, 'is-hidden', ! this.shows( r ) );
			const tags = `${ r.made ? '<i class="tr-tagm" title="Made here: cheap, and the stall restocks">made here</i>' : '' }${ r.wanted ? '<i class="tr-tagw" title="Wanted here: dear, until the demand fills up">wanted</i>' : '' }${ r.locked ? '<i class="tr-tagl" title="The guild sells it to licensed merchants only">licence</i>' : '' }`;
			put( f.meta, 'html', `${ tags }${ r.unit } · ${ r.crates } crate${ r.crates > 1 ? 's' : '' }${ r.perish >= 0.01 ? ` · spoils ${ ( r.perish * 100 ).toFixed( 0 ) }%/h` : '' }${ r.event ? ` · <em>${ r.event.pct >= 0 ? '+' : '' }${ r.event.pct }%</em>` : '' }` );
			put( f.why, 'text', r.why || '' );
			prop( f.why, 'title', r.why || '' );
			const tr = r.trend || { dir: 'flat', pct: 0 };
			put( f.trend, 'text', `${ tr.dir === 'up' ? '\u25B2' : tr.dir === 'down' ? '\u25BC' : '\u25B6' } ${ tr.pct > 0 ? '+' : '' }${ tr.pct }%` );
			prop( f.trend, 'className', `tr-trend is-${ tr.dir }` );
			prop( f.trend, 'title', 'Change over the last day' );
			tog( f.el, 'is-event', r.event );
			put( f.buy, 'text', price( r.buy ) );
			put( f.tag, 'text', r.tag );
			prop( f.tag, 'title', r.tag === 'cheap' ? 'Cheap here: a good place to buy' : r.tag === 'dear' ? 'Dear here: a good place to sell' : r.tag === 'contraband' ? 'Contraband here: only the smuggler deals in it, and customs seize it' : '' );
			prop( f.tag, 'className', r.tag ? `is-${ r.tag }` : '' );
			put( f.sell, 'text', price( r.sell * ( r.held ? r.cond : 1 ) ) );
			put( f.cond, 'text', r.held && r.cond < 0.995 ? `${ Math.round( r.cond * 100 ) }% condition` : '' );
			const rc = this.routeCell( r );
			put( f.other, 'html', rc.b );
			tog( f.otherbox, 'is-stale', ( r.best && r.best.rumour ) || ( ! r.best && r.other.rumour ) );
			prop( f.otherbox, 'title', r.source && r.source.margin > 0 && ! r.held ? `Cheapest to bring here from ${ r.source.name } (${ price( r.source.price ) })` : r.best ? `${ r.best.name }: ${ price( r.best.price ) } a unit${ r.best.rumour ? ' (rumour)' : '' }, ${ ( r.best.metres / 1000 ).toFixed( 1 ) } km` : '' );
			put( f.note, 'text', rc.note );
			prop( f.note, 'className', rc.cls );
			put( f.age, 'text', rc.age );
			put( f.held, 'text', r.held ? String( r.held ) : '-' );
			put( f.heldv, 'text', r.held ? `paid ${ money( r.paid ) }` : '' );
			this.spark( f, r );
			for ( const b of f.buttons ) prop( b, 'disabled', b.dataset.act === 'buy' ? ! r.can.buy : ! r.can.sell );

		}

	}

	// the 2-day price line, scaled to its own range, with the equilibrium as a dashed rule
	spark( f, r ) {

		const h = r.hist;
		let lo = Math.min( ...h, r.mid ), hi = Math.max( ...h, r.mid );
		const pad = Math.max( ( hi - lo ) * 0.15, r.mid * 0.03 );
		lo -= pad;
		hi += pad;
		const y = ( p ) => ( 20.5 - ( p - lo ) / ( hi - lo ) * 19 ).toFixed( 1 );
		const n = h.length;
		attr( f.line, 'points', h.map( ( p, i ) => `${ ( n > 1 ? i / ( n - 1 ) * 63 : 63 ).toFixed( 1 ) },${ y( p ) }` ).join( ' ' ) );
		attr( f.dot, 'cx', '63' );
		attr( f.dot, 'cy', y( h[ n - 1 ] ) );
		attr( f.eq, 'y1', y( r.eq ) );
		attr( f.eq, 'y2', y( r.eq ) );

	}

	refreshText( v ) {

		const t = this.trade;
		const html = this.tab === 'ledger' ? this.ledgerHtml( v )
			: this.tab === 'contracts' ? this.contractsHtml( t.haul.view( this.port ) )
				: this.tab === 'credit' ? this.creditHtml( t.credit.view( this.port ) )
					: this.tab === 'costs' ? this.costsHtml( t.operating.view() )
						: this.tab === 'den' ? this.denHtml( t.smuggler.view( this.port ) )
							: this.newsHtml( v );
		if ( html === this._cache ) return;
		this._cache = html;
		this._f.body.innerHTML = html;

	}

	ledgerHtml( v ) {

		const L = v.ledger;
		const best = L.best;
		const routes = L.routeList;
		const goods = Object.keys( L.goods ).map( ( g ) => ( { g, ...L.goods[ g ] } ) ).sort( ( a, b ) => b.profit - a.profit );
		return `
			<div class="tr-stats">
				<div><span>Net profit</span><b class="${ L.profit >= 0 ? 'tr-pos' : 'tr-neg' }">${ signed( L.profit ) }</b></div>
				<div><span>Trips</span><b>${ L.trips }</b></div>
				<div><span>Spent</span><b>${ money( L.spent ) }</b></div>
				<div><span>Sales</span><b>${ money( L.revenue ) }</b></div>
			</div>
			<h3>Best trade</h3>
			${ best ? `<div>${ esc( GOODS[ best.good ].name ) } x${ best.qty }, ${ best.from === best.to ? 'flipped at ' + esc( portName( best.to ) ) : `${ esc( portName( best.from ) ) } to ${ esc( portName( best.to ) ) }` }: <b class="${ best.profit >= 0 ? 'tr-pos' : 'tr-neg' }">${ signed( best.profit ) }</b> (day ${ best.day })</div>` : '<div class="tr-empty">No sales yet. Buy where it is cheap, sell where it is dear.</div>' }
			<h3>Routes</h3>
			${ routes.length ? `<table class="tr-table"><tr><th>Route</th><th>Sales</th><th>Units</th><th>Sold for</th><th>Profit</th></tr>${ routes.map( ( r ) => `<tr><td>${ esc( r.label ) }</td><td>${ r.sales }</td><td>${ r.units }</td><td>${ money( r.revenue ) }</td><td class="${ r.profit >= 0 ? 'tr-pos' : 'tr-neg' }">${ signed( r.profit ) }</td></tr>` ).join( '' ) }</table>` : '<div class="tr-empty">No routes sailed yet.</div>' }
			<h3>By goods</h3>
			${ goods.length ? `<table class="tr-table"><tr><th>Goods</th><th>Units</th><th>Sold for</th><th>Profit</th></tr>${ goods.map( ( x ) => `<tr><td>${ esc( GOODS[ x.g ].name ) }</td><td>${ x.units }</td><td>${ money( x.revenue ) }</td><td class="${ x.profit >= 0 ? 'tr-pos' : 'tr-neg' }">${ signed( x.profit ) }</td></tr>` ).join( '' ) }</table>` : '<div class="tr-empty">Nothing sold yet.</div>' }
			${ L.costs ? `<h3>Costs of trading</h3><table class="tr-table"><tr><th>Harbour dues</th><th>Insurance</th><th>Warehouse</th><th>Net profit</th></tr><tr><td style="text-align:right">${ money( L.costs.dues ) }</td><td>${ money( L.costs.insurance ) }</td><td>${ money( L.costs.rent ) }</td><td class="${ ( L.net ?? L.profit ) >= 0 ? 'tr-pos' : 'tr-neg' }">${ signed( L.net ?? L.profit ) }</td></tr></table>` : '' }
			${ L.fish && L.fish.sold ? `<div class="tr-empty">Fish halls: ${ money( L.fish.sold ) } for the catch, ${ signed( L.fish.bonus ) } for freshness, taste and the wanted fish.</div>` : '' }`;

	}

	newsHtml( v ) {

		const live = v.events.map( ( e ) => `<li class="is-active"><time>${ Math.round( e.left ) } h left</time><span>${ esc( e.text ) }</span></li>` ).join( '' );
		const old = v.news.filter( ( n ) => ! n.active ).map( ( n ) => `<li><time>${ hours( n.age ) }</time><span>${ esc( n.text ) }</span></li>` ).join( '' );
		return `${ v.rumour ? `<h3>Rumour</h3><ul class="tr-news"><li><span>${ esc( v.rumour ) }</span></li></ul>` : '' }<h3>Happening now</h3><ul class="tr-news">${ live || '<li><span>The markets are quiet.</span></li>' }</ul><h3>Earlier</h3><ul class="tr-news">${ old || '<li><span>Nothing earlier.</span></li>' }</ul>`;

	}

	contractsHtml( h ) {

		const lic = h.next
			? `<div class="tr-card"><div><b>${ esc( h.licence.name ) }</b><small>Next: ${ esc( h.next.name ) }: ${ esc( h.next.unlocks || '' ) }, loads up to ${ h.next.maxCrates } crates${ h.next.standing ? `, needs standing ${ h.next.standing }` : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="licence">${ h.next.price ? money( h.next.price ) : 'Free' }</button></div></div>`
			: `<div class="tr-card"><div><b>${ esc( h.licence.name ) }</b><small>Any load you can carry</small></div></div>`;
		const act = h.active.map( ( c ) => `<div class="tr-card"><div><b>${ c.qty } ${ esc( c.name.toLowerCase() ) } to ${ esc( c.toName ) }</b><small>${ c.crates } crate${ c.crates > 1 ? 's' : '' } aboard · ${ money( c.reward ) } on delivery${ c.paidDeposit ? ` + ${ money( c.paidDeposit ) } deposit back` : '' } · <span class="${ c.left < 3 ? 'tr-bad' : '' }">${ left( c.left ) }</span>${ c.here ? ' · delivered when you open this stall' : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="abandon" data-id="${ c.id }" title="The deposit is forfeit">Abandon</button></div></div>` ).join( '' );
		const offers = h.offers.map( ( o ) => `<div class="tr-card"><div><b>${ o.qty } ${ esc( o.name.toLowerCase() ) } to ${ esc( o.toName ) }</b><small>${ o.crates } crate${ o.crates > 1 ? 's' : '' } · pays ${ money( o.reward ) } · deposit ${ money( o.deposit ) } · ${ o.hours } h${ o.why ? ` · <span class="tr-bad">${ esc( o.why ) }</span>` : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="accept" data-id="${ o.id }" ${ o.ok ? '' : 'disabled' }>Take it</button></div></div>` ).join( '' );
		return `<h3>Licence</h3>${ lic }<h3>Aboard</h3>${ act || '<div class="tr-empty">No consignments aboard.</div>' }<h3>On the board here</h3>${ offers || '<div class="tr-empty">Nothing posted. Come back later.</div>' }<div class="tr-empty">Delivered ${ h.done } · failed ${ h.failed }</div>`;

	}

	creditHtml( c ) {

		if ( c.sandbox ) return `<div class="tr-stats"><div><span>Standing</span><b>${ Math.floor( c.standing ) }</b></div></div><div class="tr-empty">Sandbox: nobody needs a loan.</div>`;
		const amounts = [ 100, 250, 500, 1000, 2500 ].filter( ( a ) => a <= c.limit );
		const days = c.days.map( ( d ) => `<button class="tr-btn${ d === this.loanDays ? ' is-on' : '' }" data-act="days" data-days="${ d }">${ d } d</button>` ).join( '' );
		const loans = c.loans.map( ( l ) => `<div class="tr-card"><div><b>${ money( Math.ceil( l.owed ) ) } at ${ esc( l.name ) }</b><small>${ l.why === 'loan' ? `borrowed ${ money( l.principal ) }` : esc( l.why ) } · ${ ( l.rate * 100 ).toFixed( 1 ) }% a day · <span class="${ l.status !== 'open' ? 'tr-bad' : '' }">${ l.status === 'open' ? left( l.left ) : l.status }</span></small></div>${ l.port === c.port ? `<div class="tr-act"><button class="tr-btn" data-act="repay">Repay</button></div>` : '' }</div>` ).join( '' );
		return `
			<div class="tr-stats">
				<div><span>Standing</span><b>${ Math.floor( c.standing ) }</b></div>
				<div><span>Credit here</span><b>${ money( c.limit ) }</b></div>
				<div><span>Interest</span><b>${ ( c.rate * 100 ).toFixed( 1 ) }%/d</b></div>
				<div><span>Owed</span><b class="${ c.owed > 0 ? 'tr-neg' : '' }">${ money( Math.ceil( c.owed ) ) }</b></div>
			</div>
			<h3>Borrow here</h3>
			${ c.blocked ? '<div class="tr-empty tr-bad">You defaulted here. Pay it first.</div>' : amounts.length ? `<div class="tr-card"><div>Term <span class="tr-act" style="display:inline-flex">${ days }</span><small>Repaid here, with interest; late loans cost double and your standing</small></div><div class="tr-act">${ amounts.map( ( a ) => `<button class="tr-btn" data-act="loan" data-amount="${ a }">${ money( a ) }</button>` ).join( '' ) }</div></div>` : '<div class="tr-empty">The lender will not advance you more here.</div>' }
			<h3>Your loans</h3>${ loans || '<div class="tr-empty">No debts.</div>' }
			<div class="tr-empty">Standing rises with profitable voyages, delivered contracts and loans repaid on time; it narrows the stalls' spread, lowers interest and calms customs.</div>`;

	}

	// dues, insurance and the warehouse (wave 15B); d = trade.dues.view(), w = the warehouse view or null, held = cargo
	harbourHtml( d, w, held = {} ) {

		if ( ! d ) return '';
		const ins = d.insurance;
		const fee = d.feeHere.waived ? { home: 'none at home', beloved: 'waived: this port loves you', sandbox: 'sandbox', foot: 'no boat', unknown: '-' }[ d.feeHere.waived ] || 'waived' : money( d.feeHere.fee ) + ' a docking';
		const policy = ins.active && ins.policy ? `Insured: ${ money( ins.policy.value ) } of cargo, ${ left( ins.policy.left ) }` : `Covers 80% of the cost of cargo pirates take or that sinks with the boat, for ${ ins.hours } h`;
		let out = `<h3>Harbourmaster</h3>
			<div class="tr-card"><div><b>Harbour dues</b><small>Here: ${ fee } · by hull size, waived at home and where you are loved · paid so far ${ money( d.paid ) }</small></div></div>
			<div class="tr-card"><div><b>Cargo insurance</b><small>${ policy } · ${ ( ins.rate * 100 ).toFixed( 1 ) }% of the cargo's cost${ ins.value ? ` (${ money( ins.value ) } aboard)` : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="insure" ${ ins.active || ins.value < 40 ? 'disabled' : '' }>${ ins.premium ? money( ins.premium ) : 'Free' }</button></div></div>`;
		if ( w ) {

			const stored = Object.keys( w.goods ).map( ( g ) => `<div class="tr-card"><div><b>${ w.goods[ g ].qty } ${ esc( GOODS[ g ].name.toLowerCase() ) }</b><small>in store${ w.goods[ g ].cond < 0.995 ? ` at ${ Math.round( w.goods[ g ].cond * 100 ) }%` : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="withdraw" data-good="${ g }">Load all</button></div></div>` ).join( '' );
			const carry = Object.keys( held ).map( ( g ) => `<button class="tr-btn" data-act="store" data-good="${ g }">Store ${ esc( GOODS[ g ].name.toLowerCase() ) }</button>` ).join( '' );
			out += `<h3>${ esc( w.name ) } warehouse</h3><div class="tr-card"><div><b>${ w.used } / ${ w.capacity } crates</b><small>${ w.sandbox ? 'Sandbox: no rent' : `${ money( w.rent ) } a crate a day · ${ money( w.rentPerDay ) } a day now` }${ w.owed > 0 ? ` · <span class="tr-bad">${ money( Math.ceil( w.owed ) ) } rent owed</span>` : '' }</small></div>${ w.owed > 0 ? '<div class="tr-act"><button class="tr-btn" data-act="rent">Pay rent</button></div>' : '' }</div>${ stored }${ carry ? `<div class="tr-act" style="justify-content:flex-start;flex-wrap:wrap;margin-top:var(--tw-2)">${ carry }</div>` : '' }`;

		} else out += '<div class="tr-empty">The Tidemark warehouse stores cargo for a crate-day rent.</div>';
		return out;

	}

	costsHtml( o ) {

		const t = this.trade;
		const harbour = t && t.dues ? this.harbourHtml( t.dues.view(), t.warehouse.here( this.port ) ? t.warehouse.view() : null, t.cargo ) : '';
		if ( o.sandbox ) return `<div class="tr-empty">Sandbox: bait, wages, upkeep and dues cost nothing.</div>${ harbour }`;
		return `
			<div class="tr-stats">
				<div><span>Bait</span><b class="${ o.bait < 5 ? 'tr-neg' : '' }">${ o.bait }</b></div>
				<div><span>Wages / day</span><b>${ money( o.wages ) }</b></div>
				<div><span>Upkeep / day</span><b>${ money( o.upkeep ) }</b></div>
				<div><span>Owed</span><b class="${ o.owed > 0 ? 'tr-neg' : '' }">${ money( Math.ceil( o.owed ) ) }</b></div>
			</div>
			<div class="tr-card"><div><b>Bait</b><small>One per cast; a bare hook bites slowly. ${ o.tin } for ${ money( o.tinPrice ) }</small></div><div class="tr-act"><button class="tr-btn" data-act="bait" data-n="${ o.tin }">+${ o.tin }</button><button class="tr-btn" data-act="bait" data-n="${ o.tin * 5 }">+${ o.tin * 5 }</button></div></div>
			<div class="tr-card"><div><b>Crew of ${ o.crew }</b><small>${ o.deserted ? '<span class="tr-bad">The crew walked off: the ship sails short-handed</span>' : o.missedDays ? `<span class="tr-bad">${ o.missedDays } day${ o.missedDays > 1 ? 's' : '' } unpaid</span>` : 'Paid at the turn of each day' } · next bill in ${ Math.ceil( o.nextBillIn ) } h</small></div>${ o.owed > 0 ? `<div class="tr-act"><button class="tr-btn" data-act="payowed">Pay ${ money( Math.ceil( o.owed ) ) }</button></div>` : '' }</div>
			<div class="tr-empty">Spent so far: bait ${ money( o.spent.bait ) } · wages ${ money( o.spent.wages ) } · upkeep ${ money( o.spent.upkeep ) }</div>${ harbour }`;

	}

	denHtml( d ) {

		if ( ! d.here ) return '<div class="tr-empty">Nobody here. He only comes after dark.</div>';
		const rows = d.rows.map( ( r ) => `<div class="tr-card"><div><b><i class="tr-sw" style="background:${ r.color };display:inline-block;height:1em;vertical-align:middle"></i> ${ esc( r.name ) }</b><small>He pays ${ price( r.bid ) } a ${ esc( r.unit ) } · you carry ${ r.held }${ r.held && r.cond < 0.995 ? ` at ${ Math.round( r.cond * 100 ) }%` : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="ssell" data-good="${ r.good }" data-n="1" ${ r.held ? '' : 'disabled' }>Sell 1</button><button class="tr-btn" data-act="ssell" data-good="${ r.good }" data-n="all" ${ r.held ? '' : 'disabled' }>Sell all</button></div></div>` ).join( '' );
		const comp = d.nextCompartment ? `<div class="tr-card"><div><b>Hidden compartment</b><small>Now hides ${ d.compartment.hides } crates; next hides ${ d.nextCompartment.hides }${ d.nextCompartment.trust ? `, wants trust ${ d.nextCompartment.trust }` : '' }</small></div><div class="tr-act"><button class="tr-btn" data-act="compartment">${ money( d.nextCompartment.price ) }</button></div></div>` : `<div class="tr-card"><div><b>Hidden compartment</b><small>Hides ${ d.compartment.hides } crates</small></div></div>`;
		return `
			<div class="tr-stats"><div><span>Trust</span><b>${ d.trust }</b></div><div><span>Papers</span><b>${ d.papers } / ${ d.papersMax }</b></div><div><span>Hides</span><b>${ d.compartment.hides } crates</b></div><div><span>Port</span><b>${ esc( d.portName ) }</b></div></div>
			<h3>He buys tonight</h3>${ rows || '<div class="tr-empty">Nothing he wants here.</div>' }
			<h3>Services</h3>${ comp }
			<div class="tr-card"><div><b>Forged papers</b><small>Wave you through one customs inspection</small></div><div class="tr-act"><button class="tr-btn" data-act="papers" ${ d.papers >= d.papersMax ? 'disabled' : '' }>${ money( d.papersPrice ) }</button></div></div>`;

	}

	// ---- input

	_click( e ) {

		const b = e.target && e.target.closest ? e.target.closest( '[data-act]' ) : null;
		if ( ! b || b.disabled ) return;
		const act = b.dataset.act;
		if ( act === 'close' ) {

			this.trade.close();
			return;

		}

		if ( act === 'tab' ) {

			this.tab = b.dataset.tab;
			this.build();
			this.refresh();
			return;

		}

		if ( this._service( act, b ) ) {

			this._cache = '';
			this.refresh();
			return;

		}

		const row = b.closest( '[data-good]' );
		if ( ! row || ( act !== 'buy' && act !== 'sell' ) ) return;
		const good = row.dataset.good;
		const n = b.dataset.n === 'max' || b.dataset.n === 'all' ? b.dataset.n : Number( b.dataset.n );
		const r = act === 'buy' ? this.trade.buy( this.port, good, n ) : this.trade.sell( this.port, good, n );
		const name = GOODS[ good ].name.toLowerCase();
		if ( ! r.ok ) this.msg = { text: r.message, bad: true, at: performance.now() };
		else if ( act === 'buy' ) this.msg = { text: `Bought ${ r.qty } ${ name } for ${ money( r.total ) }${ r.limited === 'capacity' ? ' (the hold is full)' : r.limited === 'money' ? ' (all you could pay for)' : r.limited === 'licence' ? ' (a bulk lot wants the master licence)' : '' }.`, bad: false, at: performance.now() };
		else this.msg = { text: `Sold ${ r.qty } ${ name } for ${ money( r.total ) }: ${ r.profit >= 0 ? 'profit' : 'loss' } ${ signed( r.profit ) }.`, bad: false, at: performance.now() };
		this._cache = '';
		this.refresh();

	}

	// the buttons of the Contracts / Credit / Costs / Contraband tabs and the compare row; true when handled
	_service( act, b ) {

		const t = this.trade, port = this.port;
		const say = ( r, good ) => { this.msg = { text: r.ok ? good : r.message, bad: ! r.ok, at: performance.now() }; };
		switch ( act ) {

			case 'cmp': t.setCompare( port, b.dataset.port ); this._cmpKey = ''; return true;
			case 'filter': this.filter = [ 'port', 'hold', 'all' ].includes( b.dataset.filter ) ? b.dataset.filter : 'port'; return true;
			case 'insure': { const r = t.dues.insure(); say( r, r.ok ? `Insured ${ money( r.value ) } of cargo for ${ money( r.premium ) }.` : '' ); return true; }
			case 'store': { const r = t.warehouse.store( port, b.dataset.good, 'all' ); say( r, r.ok ? `Stored ${ r.qty } in the warehouse.` : '' ); return true; }
			case 'withdraw': { const r = t.warehouse.withdraw( port, b.dataset.good, 'all' ); say( r, r.ok ? `Loaded ${ r.qty } from the warehouse.` : '' ); return true; }
			case 'rent': { const r = t.warehouse.payOwed(); say( r, r.ok ? `Paid ${ money( r.paid ) } of rent.` : '' ); return true; }
			case 'licence': { const r = t.haul.buyLicence(); say( r, r.ok ? `You hold the ${ r.name }.` : '' ); return true; }
			case 'accept': { const r = t.haul.accept( port, b.dataset.id ); say( r, r.ok ? `Loaded ${ r.contract.qty } ${ GOODS[ r.contract.good ].name.toLowerCase() } for ${ portName( r.contract.to ) }.` : '' ); return true; }
			case 'abandon': t.haul.abandon( b.dataset.id ); this.msg = { text: 'Contract abandoned: the deposit is forfeit.', bad: true, at: performance.now() }; return true;
			case 'days': this.loanDays = Number( b.dataset.days ) || 3; return true;
			case 'loan': { const r = t.credit.take( port, Number( b.dataset.amount ), this.loanDays ); say( r, r.ok ? `Borrowed ${ money( r.loan.principal ) }, due in ${ this.loanDays } days.` : '' ); return true; }
			case 'repay': { const r = t.credit.repay( port, 'all' ); say( r, r.ok ? `Repaid ${ money( r.paid ) }${ r.cleared ? ': clear here.' : '.' }` : '' ); return true; }
			case 'bait': { const r = t.operating.buyBait( Number( b.dataset.n ) ); say( r, r.ok ? `Bought ${ r.qty } bait.` : '' ); return true; }
			case 'payowed': { const r = t.operating.payOwed(); say( r, r.ok ? `Paid ${ money( r.paid ) }.` : '' ); return true; }
			case 'ssell': { const n = b.dataset.n === 'all' ? 'all' : Number( b.dataset.n ); const r = t.smuggler.sell( port, b.dataset.good, n ); say( r, r.ok ? `Sold ${ r.qty } for ${ money( r.total ) }: ${ signed( r.profit ) }.` : '' ); return true; }
			case 'compartment': { const r = t.smuggler.buyCompartment(); say( r, r.ok ? `Your hold now hides ${ r.hides } crates.` : '' ); return true; }
			case 'papers': { const r = t.smuggler.buyPapers(); say( r, r.ok ? `You carry ${ r.papers } set${ r.papers > 1 ? 's' : '' } of papers.` : '' ); return true; }
			default: return false;

		}

	}

}
