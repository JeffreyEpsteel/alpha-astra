import { GlassPanel, esc, money, clockText } from '../harbour/PanelKit.js';
import { GOODS } from '../trade/goods.js';
import { ITEMS, LURES, RECIPES, SHELF_PRICE, pickFish } from './Recipes.js';

// The workbench window (E at a bench, talking to its keeper, or harbour.openService( 'crafting' )). Recipes
// with what they take (have / missing) and a Make button; the kit (bait toggle, the lure on the line, patch
// kits with Use); the shelf: what the harbour's residents made on their work loops, for sale.

export class CraftPanel extends GlassPanel {

	constructor( crafting ) {

		super( crafting.app );
		this.c = crafting;
		this.site = null;
		this.msg = null;

	}

	show( site ) {

		this.site = site;
		this.msg = null;
		this._last = null;
		return this.open();

	}

	_needs( r ) {

		const c = this.c, st = c.state, parts = [];
		if ( r.fish ) {

			const ok = !! pickFish( st ? st.inventory : [], r.fish );
			parts.push( `<span class="${ ok ? 'is-ok' : 'is-miss' }">${ r.fish.count } fish${ r.fish.minKg ? ` ${ r.fish.minKg } kg+` : '' }</span>` );

		}

		for ( const [ g, q ] of Object.entries( r.goods || {} ) ) {

			const ok = c._cargo( g ) >= q;
			parts.push( `<span class="${ ok ? 'is-ok' : 'is-miss' }">${ q } ${ esc( GOODS[ g ] ? GOODS[ g ].name.toLowerCase() : g ) }</span>` );

		}

		return parts.join( ' + ' );

	}

	render() {

		const c = this.c, s = this.site || {}, h = c.harbour, st = c.state;
		const keeper = c.keeperName( s );
		const hour = h ? h.hour : 12;
		let html = `<div class="hb-head"><div><h2>${ esc( s.name || 'Workbench' ) }</h2>
			<p class="hb-sub">${ keeper ? esc( keeper ) + ' works the bench · ' : '' }<b>${ clockText( hour ) }</b>${ st ? ` · purse <b>${ money( st.money ) }</b>` : '' }</p></div>
			<button class="hb-btn" data-act="close">Close (E)</button></div><div class="hb-body"><h3>Recipes</h3>`;
		for ( const r of RECIPES ) {

			if ( r.ports && ! r.ports.includes( s.port ) ) continue;
			const chk = c.check( r.id, s.port );
			const out = r.out.item ? ITEMS[ r.out.item ].name : GOODS[ r.out.good ].name;
			html += `<div class="hb-row"><div><b>${ esc( r.name ) }${ r.out.qty > 1 ? ` x${ r.out.qty }` : '' }</b><small>${ esc( r.text ) }</small><small>${ this._needs( r ) }${ r.out.item ? '' : ` → ${ esc( out ) }` }</small></div>
				<span class="hb-price">${ r.coins ? money( r.coins ) : '' }</span><button class="hb-btn is-small" data-act="craft" data-id="${ r.id }"${ chk.ok ? '' : ' disabled' }>Make</button></div>`;

		}

		const k = c.stock;
		html += `<h3>Your kit</h3><div class="hb-chips">
			<span class="hb-chip">Bait <b>${ k.bait }</b></span>
			<span class="hb-chip">Feather jigs <b>${ k.lure }</b></span>
			<span class="hb-chip">Pearl spoons <b>${ k.pearlLure }</b></span>
			<span class="hb-chip">Patch kits <b>${ k.repairKit }</b></span>
			<span class="hb-chip">On the line: <b>${ c.tied ? esc( ITEMS[ c.tied.item ].name ) + ' (' + c.tied.uses + ')' : 'bare hook' }</b></span></div>
			<div class="hb-chips">
			<button class="hb-btn is-small" data-act="bait">${ c.useBait ? 'Bait the hook: on' : 'Bait the hook: off' }</button>
			${ LURES.map( ( l ) => `<button class="hb-btn is-small" data-act="tie" data-id="${ l }"${ k[ l ] > 0 ? '' : ' disabled' }>Tie on ${ esc( ITEMS[ l ].name.toLowerCase() ) }</button>` ).join( '' ) }
			<button class="hb-btn is-small" data-act="untie"${ c.tied ? '' : ' disabled' }>Take lure off</button>
			<button class="hb-btn is-small is-gold" data-act="patch"${ k.repairKit > 0 ? '' : ' disabled' }>Use a patch kit</button></div>`;
		const sh = c.shelf( s.port );
		html += `<h3>Made in the harbour</h3>
			<div class="hb-row"><div><b>Fishers' bait</b><small>${ sh.bait || 0 } on the shelf, cut by the harbour's fishers.</small></div><span class="hb-price">${ money( SHELF_PRICE.bait ) }</span>
			<button class="hb-btn is-small" data-act="shelf" data-id="bait"${ sh.bait > 0 ? '' : ' disabled' }>Buy 5</button></div>
			<div class="hb-row"><div><b>Dockside rope</b><small>${ sh.rope || 0 } coils, twisted by the dockworkers (goes into the hold).</small></div><span class="hb-price">${ money( SHELF_PRICE.rope ) }</span>
			<button class="hb-btn is-small" data-act="shelf" data-id="rope"${ sh.rope > 0 ? '' : ' disabled' }>Buy 1</button></div></div>`;
		html += `<div class="hb-msg${ this.msg && this.msg.bad ? ' is-bad' : '' }">${ this.msg ? esc( this.msg.text ) : '' }</div>`;
		return html;

	}

	onClick( act, el ) {

		const c = this.c, port = this.site ? this.site.port : 'home';
		let r = null;
		if ( act === 'craft' ) r = c.craft( el.dataset.id, port );
		else if ( act === 'tie' ) r = c.tie( el.dataset.id );
		else if ( act === 'untie' ) r = c.untie();
		else if ( act === 'patch' ) r = c.useRepairKit();
		else if ( act === 'shelf' ) r = c.buyShelf( el.dataset.id, el.dataset.id === 'bait' ? 5 : 1, port );
		else if ( act === 'bait' ) {

			c.useBait = ! c.useBait;
			r = { ok: true, message: c.useBait ? 'You bait the hook when you have bait.' : 'Bare hook: your bait stays in the box.' };

		}

		if ( r ) this.msg = { text: r.message, bad: ! r.ok };

	}

}
