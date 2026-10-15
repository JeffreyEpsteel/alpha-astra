// The hangar window (E at the seaplane ramp): buy the seaplane ($18,000 in a campaign, free in the sandbox), repair
// it, bring it back to the berth, and the short flying notes. A glass panel in the HUD's look (the --tw-* tokens of
// ui/ui.css, .tw-glass), built lazily the first time it opens; Escape or the close button shuts it.
// Everything it shows comes from seaplane.view(); the buttons call seaplane.buy() / repair() / refuel() / recall().
// Wave 10: after a crash the plane is lost: "Recover the wreck" (recall(): Captain Roid's crew, CRASH.recovery) comes
// first, then the repair; a sprung float shows as a row.
// Wave 8: while piloting the same window is the cockpit's switch panel (3, or the touch controls' Cockpit button):
// every panel control as a button (seaplane.act( id )), plus climbing out and refuelling when they are possible.
// Wave 12 (airframes): the hangar lists the airframes of its scope (the ramp: Jade, Petrel, Albatross; the airstrip:
// the Kestrel) with Buy / Take out, then the one out: its condition, fuel, cargo and the upgrade rows (seaplane.fit).
// Wave 14B: the airstrip hangar recovers / tows its airframe to its own pad (recall( { at: 'strip' } ): "towed here").

import { t } from '../../i18n/index.js';

const CSS = /* css */`
.sp-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); width: min(calc(460 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge)));
	padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); z-index: 6; }
.sp-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.tw-root.is-photo .sp-panel { display: none; }
.sp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--tw-3); }
.sp-head h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.sp-sub { margin: 0; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.sp-btn { font: 600 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); background: var(--tw-fill-2); border: 0; border-radius: 999px; padding: var(--tw-2) var(--tw-4); cursor: pointer; white-space: nowrap; }
.sp-btn:hover:not([disabled]) { background: var(--tw-line-2); }
.sp-btn.is-main { color: var(--tw-aqua); box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.45); }
.sp-btn[disabled] { opacity: 0.35; cursor: default; }
.sp-rows { margin: var(--tw-3) 0; display: grid; gap: var(--tw-2); }
.sp-row { display: flex; justify-content: space-between; align-items: center; gap: var(--tw-3); padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); background: var(--tw-fill); border: 1px solid var(--tw-line); }
.sp-row span { color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.sp-row b { font: 600 var(--tw-fs-md) var(--tw-mono); }
.sp-bar { flex: 1; max-width: calc(160 * var(--tw-u)); height: calc(6 * var(--tw-u)); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.sp-bar > i { display: block; height: 100%; background: var(--tw-aqua); border-radius: inherit; }
.sp-bar.is-low > i { background: var(--tw-coral); }
.sp-acts { display: flex; flex-wrap: wrap; gap: var(--tw-2); }
.sp-notes { margin: var(--tw-3) 0 0; padding: var(--tw-3) 0 0; border-top: 1px solid var(--tw-line); color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.55; }
.sp-notes kbd { font: 600 var(--tw-fs-xs) var(--tw-mono); padding: 0 calc(4 * var(--tw-u)); border-radius: 4px; background: var(--tw-fill-2); color: var(--tw-ink); }
.sp-msg { min-height: 1.4em; margin-top: var(--tw-2); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.sp-msg.is-bad { color: var(--tw-coral); }
.sp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--tw-2); margin: var(--tw-3) 0; }
.sp-grid .sp-btn { white-space: normal; padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); }
.sp-btn.is-on { color: var(--tw-aqua); box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.55); }
.sp-panel.is-cockpit { top: auto; bottom: var(--tw-edge); transform: translate(-50%, 8%); }
.sp-panel { max-height: calc(100vh - 2 * var(--tw-edge)); overflow-y: auto; }
.sp-fleet { display: grid; gap: var(--tw-2); margin: var(--tw-3) 0; }
.sp-af { display: flex; align-items: center; gap: var(--tw-3); padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); background: var(--tw-fill); border: 1px solid var(--tw-line); }
.sp-af.is-cur { box-shadow: inset 0 0 0 1px rgba(var(--tw-aqua-rgb), 0.55); }
.sp-af div { flex: 1; min-width: 0; }
.sp-af b { display: block; font-weight: 600; }
.sp-af span { color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.sp-h3 { margin: var(--tw-3) 0 var(--tw-1); font-size: var(--tw-fs-sm); color: var(--tw-ink-3); text-transform: uppercase; letter-spacing: 0.08em; }
.sp-up { display: flex; align-items: center; gap: var(--tw-2); padding: calc(4 * var(--tw-u)) var(--tw-3); border-bottom: 1px solid var(--tw-line); }
.sp-up div { flex: 1; min-width: 0; }
.sp-up span { color: var(--tw-ink-3); font-size: var(--tw-fs-xs); display: block; }
.sp-pips { font: 600 var(--tw-fs-sm) var(--tw-mono); color: var(--tw-aqua); }
.sp-up .sp-btn { padding: calc(4 * var(--tw-u)) var(--tw-3); font-size: var(--tw-fs-sm); }
.sp-panel.is-cockpit.is-open { transform: translate(-50%, 0); }
`;

let cssInstalled = false;
const money = ( n ) => '$' + String( Math.round( n ) ).replace( /\B(?=(\d{3})+(?!\d))/g, ',' );

export class SeaplanePanel {

	constructor( plane ) {

		this.plane = plane;
		this.el = null;
		this.isOpen = false;
		this.scope = 'ramp'; // wave 12: 'ramp' (the seaplanes) or 'strip' (the airstrip: the Kestrel)
		this.msg = null;
		this._keys = ( e ) => {

			if ( e.code === 'Escape' && this.isOpen ) this.close();

		};

	}

	_ensure() {

		if ( this.el ) return true;
		if ( typeof document === 'undefined' ) return false;
		const app = this.plane.app;
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
		this.el.className = 'sp-panel tw-glass tw-interactive';
		this.el.addEventListener( 'click', ( e ) => this._click( e ) );
		host.append( this.el );
		return true;

	}

	open() {

		if ( ! this._ensure() ) return false;
		this.isOpen = true;
		this.msg = null;
		this.render();
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

	say( text, bad = false ) {

		this.msg = { text, bad };
		if ( this.isOpen ) this.render();

	}

	render() {

		if ( ! this.el ) return;
		const v = this.plane.view( this.scope );
		this.el.classList.toggle( 'is-cockpit', !! v.piloted );
		if ( v.piloted ) return this._renderCockpit( v );
		const rows = [];
		let acts = '';
		// wave 12: the airframes of this hangar (buy / take out)
		const fleet = ( v.airframes || [] ).map( ( a ) => {

			const act = a.owned ? ( a.current ? `<b class="sp-pips">${ t( 'seaplane.outNow', 'out' ) }</b>` : `<button class="sp-btn" data-take="${ a.id }" ${ a.canTake ? '' : 'disabled' }>${ t( 'seaplane.takeOut', 'Take out' ) }</button>` )
				: `<button class="sp-btn is-main" data-buy="${ a.id }" ${ a.canBuy ? '' : 'disabled' }>${ v.free ? t( 'seaplane.freeShort', 'free' ) : money( a.price ) }</button>`;
			return `<div class="sp-af ${ a.current ? 'is-cur' : '' }"><div><b>${ a.name }${ a.lost ? ' · ' + t( 'seaplane.wreckedShort', 'wrecked' ) : '' }</b><span>${ a.sub } · ${ a.seats } ${ t( 'seaplane.seats', 'seats' ) }${ a.crates ? ` · ${ a.crates } ${ t( 'seaplane.crates', 'crates' ) }` : '' }</span></div>${ act }</div>`;

		} ).join( '' );
		if ( ! v.inScope ) {

			// the airframe out belongs to the other hangar (the strip / the ramp): this one only sells and swaps
			acts += `<button class="sp-btn" data-act="close">${ t( 'seaplane.close', 'Close' ) }</button>`;
			this.el.innerHTML = `
<div class="sp-head"><div><h2>${ v.scope === 'strip' ? t( 'seaplane.stripTitle', 'Airstrip hangar' ) : t( 'seaplane.title', 'Seaplane hangar' ) }</h2><p class="sp-sub">${ t( 'seaplane.outElsewhere', 'Out now' ) }: ${ v.name }</p></div></div>
<div class="sp-fleet">${ fleet }</div>
<div class="sp-acts">${ acts }</div>
<div class="sp-msg ${ this.msg && this.msg.bad ? 'is-bad' : '' }">${ this.msg ? this.msg.text : '' }</div>`;
			return;

		}

		if ( ! v.owned ) {

			rows.push( `<div class="sp-row"><span>${ t( 'seaplane.price', 'Price' ) }</span><b>${ v.free ? t( 'seaplane.free', 'Free (sandbox)' ) : money( v.price ) }</b></div>` );
			if ( ! v.free ) rows.push( `<div class="sp-row"><span>${ t( 'seaplane.wallet', 'Your money' ) }</span><b>${ money( v.money ) }</b></div>` );
			acts = `<button class="sp-btn is-main" data-act="buy" ${ v.canBuy ? '' : 'disabled' }>${ v.free ? t( 'seaplane.take', 'Take the seaplane' ) : t( 'seaplane.buy', 'Buy the seaplane' ) }</button>`;

		} else {

			const pct = Math.round( v.hp );
			rows.push( `<div class="sp-row"><span>${ t( 'seaplane.condition', 'Condition' ) }</span><div class="sp-bar ${ pct < 35 ? 'is-low' : '' }"><i style="width:${ pct }%"></i></div><b>${ pct }%</b></div>` );
			const where = v.lost ? ( v.wreck ? t( 'seaplane.wrecked', 'Wrecked: the pieces are still out there' ) : t( 'seaplane.wreckGone', 'Wrecked: on the bottom' ) ) : v.home ? t( 'seaplane.atRamp', 'At the ramp' ) : t( 'seaplane.away', 'Away from the ramp' );
			rows.push( `<div class="sp-row"><span>${ t( 'seaplane.where', 'Where' ) }</span><b>${ where }</b></div>` );
			if ( v.sprung && ! v.lost ) rows.push( `<div class="sp-row"><span>${ t( 'seaplane.floats', 'Floats' ) }</span><b>${ t( 'seaplane.sprungRow', 'One is sprung: it lists and drags' ) }</b></div>` );
			const fp = Math.round( v.fuel * 100 );
			rows.push( `<div class="sp-row"><span>${ t( 'seaplane.fuel', 'Fuel' ) }</span><div class="sp-bar ${ fp < 15 ? 'is-low' : '' }"><i style="width:${ fp }%"></i></div><b>${ Math.round( v.litres ) } L</b></div>` );
			// wave 10: a wreck comes back through Captain Roid's crew first (the recovery fee), then the repair
			const here = v.scope === 'strip'; // (the airstrip hangar: towed to its own pad)
			if ( v.lost ) acts += `<button class="sp-btn is-main" data-act="recall" ${ v.canRecover ? '' : 'disabled' }>${ t( 'seaplane.recover', 'Recover the wreck' ) }${ here ? ' · ' + t( 'seaplane.towedHere', 'towed here' ) : '' } · ${ v.free ? t( 'seaplane.freeShort', 'free' ) : money( v.recoveryCost ) }</button>`;
			if ( ! v.lost && ( v.repairCost > 0 || pct < 100 ) ) acts += `<button class="sp-btn is-main" data-act="repair" ${ v.canRepair ? '' : 'disabled' }>${ t( 'seaplane.repair', 'Repair' ) } · ${ v.free ? t( 'seaplane.freeShort', 'free' ) : money( v.repairCost ) }</button>`;
			if ( fp < 100 && ! v.lost ) acts += `<button class="sp-btn is-main" data-act="refuel" ${ v.canRefuel ? '' : 'disabled' }>${ t( 'seaplane.refuel', 'Refuel' ) } · ${ v.free ? t( 'seaplane.freeShort', 'free' ) : money( v.refuelCost ) }</button>`;
			if ( ! v.home && ! v.piloted && ! v.lost ) acts += `<button class="sp-btn" data-act="recall">${ here ? t( 'seaplane.recallHere', 'Tow it here' ) : t( 'seaplane.recall', 'Tow it back to the ramp' ) }</button>`;
			if ( v.engineOut && ! v.lost ) rows.push( `<div class="sp-row"><span>${ t( 'seaplane.engines', 'Engines' ) }</span><b>${ t( 'seaplane.engineOutRow', 'One has failed: repair it' ) }</b></div>` );
			if ( v.cargo && v.cargo.capacity > 0 ) rows.push( `<div class="sp-row"><span>${ t( 'seaplane.cargo', 'Cargo' ) }</span><b>${ v.cargo.crates } / ${ v.cargo.capacity } ${ t( 'seaplane.crates', 'crates' ) }${ v.cargo.kg ? ` · ${ v.cargo.kg } kg` : '' }</b></div>` );

		}

		// the upgrades of the airframe out (fitted explicitly, even when free)
		let ups = '';
		if ( v.owned && ! v.lost && v.upgrades ) {

			ups = v.upgrades.map( ( u ) => {

				const pips = u.paint ? u.scheme : u.tiers > 1 ? '●'.repeat( u.tier ) + '○'.repeat( u.tiers - u.tier ) : u.tier ? t( 'seaplane.fitted', 'fitted' ) : '';
				const label = u.paint ? `${ t( 'seaplane.repaint', 'Paint' ) }: ${ u.nextScheme }` : u.maxed ? '' : u.tier ? t( 'seaplane.upgrade', 'Upgrade' ) : t( 'seaplane.fit', 'Fit' );
				const btn = u.maxed ? '' : `<button class="sp-btn" data-fit="${ u.id }" ${ u.canFit ? '' : 'disabled' }>${ label }${ u.cost ? ' · ' + money( u.cost ) : '' }</button>`;
				return `<div class="sp-up"><div>${ t( 'seaplane.up.' + u.id, u.name ) } <span>${ t( 'seaplane.upNote.' + u.id, u.note ) }</span></div><b class="sp-pips">${ pips }</b>${ btn }</div>`;

			} ).join( '' );
			ups = `<p class="sp-h3">${ t( 'seaplane.upgrades', 'Upgrades' ) }${ v.home ? '' : ' · ' + t( 'seaplane.fitAtHangar', 'Upgrades are fitted at the hangar' ) }</p>${ ups }`;

		}

		acts += `<button class="sp-btn" data-act="close">${ t( 'seaplane.close', 'Close' ) }</button>`;
		const notes = t( 'seaplane.notes2', 'Board at the door from the jetty (E). <kbd>O</kbd> starts the engine (or just open the throttle), <kbd>Shift</kbd> / <kbd>C</kbd> throttle, <kbd>W</kbd> / <kbd>S</kbd> nose down / up, <kbd>A</kbd> / <kbd>D</kbd> bank (steer while taxiing), <kbd>,</kbd> / <kbd>.</kbd> rudder, <kbd>[</kbd> / <kbd>]</kbd> flaps, <kbd>-</kbd> / <kbd>=</kbd> trim, <kbd>Y</kbd> autopilot, <kbd>V</kbd> the cockpit (click its switches). <kbd>\'</kbd> twice in the air bails out on the parachute. Flaps 1, get on the step and pull back gently near 26 m/s. Land into the water slowly: a sink over 3 m/s bends the floats. A full tank lasts about 25 minutes at full power. A hard arrival springs a float; a crash breaks the plane up (you are thrown clear unless you fly straight into something): the crew of Captain Roid recovers the wreck from here.' );
		this.el.innerHTML = `
<div class="sp-head"><div><h2>${ v.scope === 'strip' ? t( 'seaplane.stripTitle', 'Airstrip hangar' ) : t( 'seaplane.title', 'Seaplane hangar' ) }</h2><p class="sp-sub">${ v.name } · ${ ( v.airframes.find( ( a ) => a.current ) || {} ).sub || t( 'seaplane.sub', 'A jade high-wing floatplane: takes off from and lands on the water' ) }</p></div></div>
<div class="sp-fleet">${ fleet }</div>
<div class="sp-rows">${ rows.join( '' ) }</div>
<div class="sp-acts">${ acts }</div>
<div class="sp-msg ${ this.msg && this.msg.bad ? 'is-bad' : '' }">${ this.msg ? this.msg.text : '' }</div>
${ ups }
<p class="sp-notes">${ notes }</p>`;

	}

	// the cockpit's switches as buttons (touch: the 3D panel cannot be tapped through the look drag)
	_renderCockpit( v ) {

		const c = v.cockpit;
		const btn = ( id, label, on = false, dis = false ) => `<button class="sp-btn ${ on ? 'is-on' : '' }" data-ctl="${ id }" ${ dis ? 'disabled' : '' }>${ label }</button>`;
		const flaps = [ t( 'seaplane.flapsUpShort', 'up' ), '1', '2', '3' ][ c.flaps ] || '0';
		const trim = ( c.trim > 0 ? '+' : '' ) + c.trim.toFixed( 1 );
		const grid = [
			btn( 'engine', c.engine ? t( 'seaplane.btnStop', 'Engine: stop' ) : c.cranking ? t( 'seaplane.btnCranking', 'Starting...' ) : t( 'seaplane.btnStart', 'Engine: start' ), c.engine ),
			btn( 'master', t( 'seaplane.btnMaster', 'Master' ), c.master ),
			btn( 'ap', t( 'seaplane.btnAp', 'Autopilot' ), c.ap ),
			btn( 'nav', t( 'seaplane.btnNav', 'Nav lights' ), c.nav ),
			btn( 'landing', t( 'seaplane.btnLanding', 'Landing light' ), c.landing ),
			btn( 'map', t( 'seaplane.btnMap', 'Map' ) ),
			btn( 'flapsUp', `${ t( 'seaplane.btnFlapsUp', 'Flaps up' ) } (${ flaps })`, false, c.flaps <= 0 ),
			btn( 'flapsDown', `${ t( 'seaplane.btnFlapsDown', 'Flaps down' ) } (${ flaps })`, false, c.flaps >= ( c.notches || 2 ) ),
			btn( 'warn', t( 'seaplane.btnWarn', 'Silence warning' ) ),
			btn( 'trimDown', `${ t( 'seaplane.btnTrimDown', 'Trim nose down' ) } (${ trim })` ),
			btn( 'trimUp', `${ t( 'seaplane.btnTrimUp', 'Trim nose up' ) } (${ trim })` ),
			c.hasSearch ? btn( 'search', t( 'seaplane.btnSearch', 'Searchlight' ), c.search ) : '',
			c.canBail ? btn( 'bail', t( 'seaplane.btnBail', 'Bail out' ) ) : '',
			c.canExit ? btn( 'exit', t( 'seaplane.climbOut', 'Climb out' ) ) : '',
		].join( '' );
		let acts = '';
		if ( v.home && v.fuel < 0.995 ) acts += `<button class="sp-btn is-main" data-act="refuel" ${ v.canRefuel ? '' : 'disabled' }>${ t( 'seaplane.refuel', 'Refuel' ) } · ${ v.free ? t( 'seaplane.freeShort', 'free' ) : money( v.refuelCost ) }</button>`;
		acts += `<button class="sp-btn" data-act="close">${ t( 'seaplane.close', 'Close' ) }</button>`;
		this.el.innerHTML = `
<div class="sp-head"><div><h2>${ t( 'seaplane.cockpit', 'Cockpit' ) }</h2><p class="sp-sub">${ t( 'seaplane.fuel', 'Fuel' ) } ${ Math.round( v.fuel * 100 ) }% · ${ t( 'seaplane.condition', 'Condition' ) } ${ Math.round( v.hp ) }%</p></div></div>
<div class="sp-grid">${ grid }</div>
<div class="sp-acts">${ acts }</div>
<div class="sp-msg ${ this.msg && this.msg.bad ? 'is-bad' : '' }">${ this.msg ? this.msg.text : '' }</div>`;

	}

	_click( e ) {

		const ctl = e.target && e.target.closest ? e.target.closest( '[data-ctl]' ) : null;
		if ( ctl && ! ctl.disabled ) {

			this.plane.act( ctl.dataset.ctl, 'panel' );
			if ( this.isOpen ) this.render();
			return;

		}

		// wave 12: buy / take out an airframe, fit an upgrade
		const w = e.target && e.target.closest ? e.target.closest( '[data-buy],[data-take],[data-fit]' ) : null;
		if ( w && ! w.disabled ) {

			const p = this.plane, d = w.dataset;
			const r = d.buy ? p.buy( d.buy ) : d.take ? p.takeOut( d.take ) : p.fit( d.fit );
			if ( r ) this.say( r.text, ! r.ok );
			return;

		}

		const b = e.target && e.target.closest ? e.target.closest( '[data-act]' ) : null;
		if ( ! b || b.disabled ) return;
		const act = b.dataset.act, p = this.plane;
		if ( act === 'close' ) return this.close();
		let r = null;
		if ( act === 'buy' ) r = p.buy();
		else if ( act === 'repair' ) r = p.repair();
		else if ( act === 'refuel' ) r = p.refuel();
		else if ( act === 'recall' ) r = p.recall( { at: this.scope === 'strip' ? 'strip' : 'home' } );
		if ( r ) this.say( r.text, ! r.ok );
		else this.render();

	}

	dispose() {

		this.close();
		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

}
