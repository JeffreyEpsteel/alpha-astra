import { GlassPanel, esc, money, clockText, dieHTML } from './PanelKit.js';
import { MENU, ASK_PRICE, isNightish } from './Tavern.js';

// The tavern window (opened with E at a tavern, or by talking to its innkeeper, or by story dialogue through
// harbour.openService( 'tavern' | 'dice' | 'rumours' )). Tabs: Menu (food and drink with their buffs, the
// buffs running now), Dice (the no-wager round against the innkeeper: two dice faces, Roll, the tally),
// Rumours (ask around for a drink, the rumours heard). Everything it shows comes from the harbour (index.js).

const TABS = [ [ 'menu', 'Menu' ], [ 'dice', 'Dice' ], [ 'rumours', 'Rumours' ], [ 'hands', 'Hands' ] ];

export class TavernPanel extends GlassPanel {

	constructor( harbour ) {

		super( harbour.app );
		this.harbour = harbour;
		this.tab = 'menu';
		this.site = null; // the tavern site open
		this.msg = null;
		this.rolling = false;

	}

	show( site, tab = 'menu' ) {

		this.site = site;
		this.tab = TABS.some( ( [ id ] ) => id === tab ) ? tab : 'menu';
		this.msg = null;
		this._last = null;
		return this.open();

	}

	say( text, bad = false ) {

		this.msg = text ? { text, bad } : null;

	}

	render() {

		const h = this.harbour, tv = h.tavern, s = this.site || {};
		const hour = h.hour, st = h.features && h.features.state;
		const keeper = s.keeper ? h.residentName( s.keeper ) : null;
		const head = `<div class="hb-head"><div><h2>${ esc( s.name || 'Tavern' ) }</h2>
			<p class="hb-sub">${ keeper ? esc( keeper ) + ' keeps the bar · ' : '' }<b>${ clockText( hour ) }</b>${ st ? ` · purse <b>${ money( st.money ) }</b>` : '' }</p></div>
			<button class="hb-btn" data-act="close">${ this.app?.ui?.ui?.root?.classList?.contains( 'is-touch' ) ? 'Close' : 'Close (E)' }</button></div>
			<div class="hb-tabs">${ TABS.map( ( [ id, name ] ) => `<button class="hb-tab${ id === this.tab ? ' is-on' : '' }" data-act="tab" data-tab="${ id }">${ name }</button>` ).join( '' ) }</div>`;
		let body = '';
		if ( this.tab === 'menu' ) {

			body += MENU.map( ( m ) => `<div class="hb-row"><div><b>${ esc( m.name ) }</b><small>${ esc( m.text ) }</small></div>
				<span class="hb-price">${ money( m.price ) }</span><button class="hb-btn is-small" data-act="buy" data-id="${ m.id }">Order</button></div>` ).join( '' );
			const buffs = tv.buffs.filter( ( b ) => tv.left( b ) > 0 );
			body += '<h3>Feeling</h3>';
			body += buffs.length ? `<div class="hb-chips">${ buffs.map( ( b ) => {

				const idle = b.night && ! isNightish( hour );
				return `<span class="hb-chip">${ esc( b.name ) } <b>${ tv.left( b ).toFixed( 1 ) } h</b>${ idle ? ' (after dusk)' : '' }</span>`;

			} ).join( '' ) }</div>` : '<div class="hb-empty">Nothing yet. A meal before a long day helps.</div>';

		} else if ( this.tab === 'dice' ) {

			const d = tv.dice, r = d.lastRound, t = d.tally;
			const who = keeper || 'The innkeeper';
			const cls = this.rolling ? 'is-rolling' : '';
			body += `<div class="hb-dice"><div class="hb-die-wrap">${ dieHTML( r ? r.player : 6, cls ) }You</div><div class="hb-die-wrap">${ dieHTML( r ? r.resident : 6, cls ) }${ esc( who ) }</div></div>
				<div class="hb-verdict">${ r ? esc( r.text ) : 'One die each. High roll wins. Nothing on it but pride.' }<small>${ t.rounds } rounds · ${ t.wins } won · ${ t.losses } lost · ${ t.draws } drawn</small></div>
				<div class="hb-center"><button class="hb-btn is-gold" data-act="roll"${ d.ready( h.time ) ? '' : ' disabled' }>Roll</button></div>`;
			this.rolling = false;

		} else if ( this.tab === 'hands' ) {

			// wave 19C: sailors for hire (the keeper vouches), and any of your crew found asleep under a table
			const cw = h.features && h.features.get ? h.features.get( 'crew' ) : null;
			body += cw && cw.tavernHtml ? cw.tavernHtml( s.port || 'home', keeper || 'The keeper' ) : '<div class="hb-empty">Nobody is looking for a berth.</div>';

		} else {

			body += `<div class="hb-row"><div><b>Ask around</b><small>Buy a drink for whoever knows something: a fishing spot, a wanted captain.</small></div>
				<span class="hb-price">${ money( ASK_PRICE ) }</span><button class="hb-btn is-small" data-act="ask">Ask</button></div>`;
			body += '<h3>Heard</h3>';
			body += tv.heard.length ? `<ul class="hb-list">${ tv.heard.map( ( r ) => `<li>${ esc( r.text ) }</li>` ).join( '' ) }</ul>` : '<div class="hb-empty">No rumours yet.</div>';

		}

		const msg = this.msg ? `<div class="hb-msg${ this.msg.bad ? ' is-bad' : '' }">${ esc( this.msg.text ) }</div>` : '<div class="hb-msg"></div>';
		return `${ head }<div class="hb-body">${ body }</div>${ msg }`;

	}

	onClick( act, el ) {

		const h = this.harbour, port = this.site ? this.site.port : 'home';
		if ( act === 'tab' ) {

			this.tab = el.dataset.tab;
			this.msg = null;

		} else if ( act === 'buy' ) {

			const r = h.order( el.dataset.id, port );
			this.say( r.ok ? `${ r.item.name }: ${ r.buff ? r.buff.name + ' for ' + r.item.buff.hours + ' h.' : 'enjoy.' }${ r.rumour ? ' ' + r.rumour.text : '' }` : r.message, ! r.ok );

		} else if ( act === 'ask' ) {

			const r = h.askRumour( port );
			this.say( r.ok ? ( r.rumour ? r.rumour.text : 'Nobody knows anything tonight.' ) : r.message, ! r.ok );

		} else if ( act === 'crew-hire' || act === 'crew-fetch' ) {

			const cw = h.features && h.features.get ? h.features.get( 'crew' ) : null;
			const r = cw && cw.tavernAct ? cw.tavernAct( act, el.dataset.id, port ) : null;
			if ( r ) this.say( r.text, ! r.ok );

		} else if ( act === 'roll' ) {

			const r = h.rollDice( port );
			this.rolling = !! r.ok;
			this.say( r.ok ? null : `Wait ${ r.wait.toFixed( 1 ) } s.`, false );

		}

	}

}
