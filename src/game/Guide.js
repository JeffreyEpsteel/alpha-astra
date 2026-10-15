import { STAND } from './FishStand.js';
import { CHANDLERY } from './Chandlery.js';
import { t, tx } from '../i18n/index.js';
import { controlKeyLabel } from '../ui/UI.js';

// First-play guide:
//  - an intro the first time the game starts, after the start overlay: PAGES below (the goal, fishing, getting around
//    with where PoorGoat and Ethena are (live direction and distance; their markers pulse on the minimap), then wave 16B's
//    pages: sailing and the harbour agents, combat, crew, planes, islands and quests, trade, the water, multiplayer).
//    Enter / Space / click: next, Esc: skip. Replay from the help (F1) or the menu.
//  - one-time tips the first time something happens (rod out, first nibble, fish on, first catch, full cooler, next to
//    the boat, at PoorGoat's, at Ethena's), in a card above the minimap. The card takes other tips too: guide.say( id, html )
//    (game/Tips.js, the contextual tips saved per save). A click or a tap on the card dismisses it.
// Pages are data: every text is an i18n key (src/i18n/en.js is the English); a line's `keys` are key refs the controls sheet
// knows (an Accessibility action id, a key code, LMB...) and read the player's bindings; `touch` is the touch button's label,
// shown instead of the keys while the touch controls are on. `{ref}` in a text is a key cap too. Five lines a page at most.
// Seen state in localStorage ('alpha-astra.guide'), wrapped in try/catch.
//   const guide = new Guide( ui, game, minimap );  guide.update( dt );  guide.replay();  guide.say( id, html )

const KEY = 'alpha-astra.guide';
export const MAX_LINES = 5;

const CSS = /* css */`
.gm-guide { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; opacity: 0; visibility: hidden;
	background: radial-gradient(70% 70% at 50% 50%, rgba(4, 10, 16, 0.2), rgba(4, 10, 16, 0.55));
	transition: opacity 420ms var(--tw-ease), visibility 0s linear 420ms; }
.gm-guide.is-on { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 420ms var(--tw-ease), visibility 0s; }
.gm-guide-card { width: min(calc(500 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge))); padding: var(--tw-5) var(--tw-5) var(--tw-4); border-radius: var(--tw-r-lg);
	color: var(--tw-ink); font: 500 var(--tw-fs-md) var(--tw-font); transform: translateY(calc(10 * var(--tw-u))); transition: transform 520ms var(--tw-ease); }
.gm-guide.is-on .gm-guide-card { transform: none; }
/* a phone in landscape: the card fits the height, the body scrolls, the buttons stay in view */
.gm-guide-card { display: flex; flex-direction: column; max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2 * var(--tw-edge)); box-sizing: border-box; }
.gm-guide-body { overflow-y: auto; min-height: 0; -webkit-overflow-scrolling: touch; }
@media (max-height: 480px) {
	.gm-guide-card { padding: var(--tw-3) var(--tw-4) var(--tw-3); width: min(calc(560 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge))); }
	.gm-guide-card h2 { font-size: calc(17 * var(--tw-u)); margin: var(--tw-1) 0 var(--tw-2); }
	.gm-guide-body { font-size: var(--tw-fs-sm); line-height: 1.4; }
	.gm-guide-foot { margin-top: var(--tw-2); }
	.gm-guide-hint { display: none; }
}
.gm-guide-eyebrow { font-size: var(--tw-fs-xs); font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: var(--tw-sun); }
.gm-guide-card h2 { margin: var(--tw-2) 0 var(--tw-3); font-size: calc(24 * var(--tw-u)); font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; }
.gm-guide-body { color: var(--tw-ink-2); line-height: 1.55; }
.gm-guide-body p { margin: 0 0 var(--tw-3); }
.gm-guide-body b { color: var(--tw-ink); font-weight: 600; }
.gm-guide-list { display: grid; gap: calc(7 * var(--tw-u)); margin: 0 0 var(--tw-3); }
.gm-guide-row { display: grid; grid-template-columns: calc(92 * var(--tw-u)) 1fr; gap: var(--tw-3); align-items: baseline; }
.gm-guide-row.is-text { grid-template-columns: 1fr; }
.gm-guide-row .k { display: flex; flex-wrap: wrap; gap: 3px; }
.gm-guide-body kbd { font: 600 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink); padding: 1px calc(6 * var(--tw-u)); border-radius: calc(4 * var(--tw-u));
	border: 1px solid var(--tw-line-2); background: var(--tw-fill); }
.gm-guide-row .gm-chip { font: 600 var(--tw-fs-xs) var(--tw-font); color: var(--tw-ink); padding: 1px calc(8 * var(--tw-u)); border-radius: 999px;
	border: 1px solid var(--tw-line-2); background: var(--tw-fill); white-space: nowrap; }
.gm-guide-where { display: grid; gap: var(--tw-2); margin: var(--tw-1) 0 var(--tw-3); }
.gm-guide-where div { display: flex; align-items: center; gap: var(--tw-3); padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); background: var(--tw-fill); border: 1px solid var(--tw-line); }
.gm-guide-where i { width: calc(12 * var(--tw-u)); height: calc(12 * var(--tw-u)); border-radius: 50%; flex: none; box-shadow: 0 0 0 1.5px rgba(255,255,255,0.8); }
.gm-guide-where .is-joe i { background: var(--tw-sun); }
.gm-guide-where .is-marta i { background: var(--tw-aqua); }
.gm-guide-where span { flex: 1; }
.gm-guide-where em { font-style: normal; font-family: var(--tw-mono); font-size: var(--tw-fs-sm); color: var(--tw-ink-2); white-space: nowrap; }
.gm-guide-note { margin: 0; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.gm-guide-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--tw-3); margin-top: var(--tw-4); }
.gm-guide-dots { display: flex; flex-wrap: wrap; gap: 6px; }
.gm-guide-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--tw-fill-2); transition: background var(--tw-med), width var(--tw-med) var(--tw-ease); }
.gm-guide-dots span.is-on { width: 18px; border-radius: 3px; background: var(--tw-sun); }
.gm-guide-btns { display: flex; align-items: center; gap: var(--tw-2); }
.gm-guide-hint { color: var(--tw-ink-3); font-size: var(--tw-fs-xs); margin-right: var(--tw-2); }
.gm-coach { position: absolute; right: var(--tw-edge); bottom: calc(var(--tw-edge) + 184 * var(--tw-u) + var(--tw-3)); width: min(calc(290 * var(--tw-u)), calc(100vw - 2 * var(--tw-edge)));
	padding: var(--tw-3) var(--tw-4); border-radius: var(--tw-r-lg); color: var(--tw-ink); font: 500 var(--tw-fs-sm) var(--tw-font); line-height: 1.5;
	pointer-events: none; opacity: 0; transform: translateY(calc(8 * var(--tw-u))); visibility: hidden; box-sizing: border-box;
	transition: opacity 360ms var(--tw-ease), transform 480ms var(--tw-ease), visibility 0s linear 480ms, right var(--tw-slow) var(--tw-ease); }
.tw-root[data-panel='open'] .gm-coach { right: calc(var(--tw-panel-w) + 2 * var(--tw-3)); }
.gm-coach.is-on { opacity: 1; transform: none; visibility: visible; pointer-events: auto; cursor: pointer; transition: opacity 360ms var(--tw-ease), transform 480ms var(--tw-ease), visibility 0s, right var(--tw-slow) var(--tw-ease); }
.gm-coach-eyebrow { display: block; margin-bottom: 3px; font-size: var(--tw-fs-xs); font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--tw-aqua); }
.gm-coach-x { position: absolute; top: calc(6 * var(--tw-u)); right: calc(8 * var(--tw-u)); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); line-height: 1; }
.gm-coach b { color: var(--tw-ink); font-weight: 600; }
.gm-coach kbd { font: 600 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink); padding: 0 calc(5 * var(--tw-u)); border-radius: calc(4 * var(--tw-u)); border: 1px solid var(--tw-line-2); background: var(--tw-fill); }

.tw-help-guide { display: flex; align-items: center; gap: var(--tw-4); margin-top: var(--tw-4); padding-top: var(--tw-4); border-top: 1px solid var(--tw-line);
	color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.5; }
.tw-help-guide b { color: var(--tw-ink); }
.tw-help-guide .gm-btn { flex: none; }
@media (max-height: 860px) { .gm-coach { right: calc(var(--tw-edge) + 58 * var(--tw-u)); } }
@media (max-width: 640px) { .tw-help-guide { flex-direction: column; align-items: flex-start; } .gm-coach { bottom: calc(var(--tw-edge) + 128 * var(--tw-u) + var(--tw-3)); } .gm-guide-row { grid-template-columns: calc(78 * var(--tw-u)) 1fr; } }
@media (prefers-reduced-motion: reduce) { .gm-guide-card, .gm-coach { transform: none !important; } }
`;

// The pages. Text keys: guide.<page>.eyebrow / .title / .<n> (n = 1..5, one per line).
// keys: key refs (ui/UI.js controlKeyLabel); 'Hold' is a word cap; touch: the touch button (an English label in en.js)
export const PAGES = [
	{ id: 'welcome', lines: [
		{}, {}, {}, {},
		{ keys: [ 'crew' ], touch: 'Crew' },
	] },
	{ id: 'fishing', lines: [
		{ keys: [ 'rod' ], touch: 'Rod' },
		{ keys: [ 'Hold', 'LMB' ], touch: 'Cast' },
		{ keys: [ 'LMB' ], touch: 'Cast' },
		{ keys: [ 'Hold', 'LMB' ], touch: 'Cast' },
		{ keys: [ 'cooler' ], touch: 'Cooler' },
	] },
	{ id: 'where', where: true, lines: [
		{ keys: [ 'forward', 'left', 'back', 'right' ], touch: 'Left thumb' },
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{ keys: [ 'F1' ], touch: 'Menu' },
	] },
	{ id: 'sail', lines: [
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{ keys: [ 'forward', 'back', 'left', 'right' ], touch: 'Lever' },
		{ keys: [ 'view' ], touch: 'View' },
		{ keys: [ 'light' ], touch: 'Lights' },
		{},
	] },
	{ id: 'combat', lines: [
		{ keys: [ 'portGuns', 'starboardGuns' ], touch: 'Port' },
		{ keys: [ 'RMB', 'LMB' ] },
		{ keys: [ 'board' ], touch: 'Board' },
		{ keys: [ 'KeyG' ], touch: 'Gun' },
		{},
	] },
	{ id: 'crew', lines: [
		{ keys: [ 'crew' ], touch: 'Crew' },
		{}, {}, {},
		{}, // wave 20D: levels, traits and moods (crew lives)
	] },
	{ id: 'planes', lines: [
		{}, {},
		{ keys: [ 'sprint', 'dive' ], touch: 'Lever' },
		{ keys: [ 'Quote' ], touch: 'Bail out' },
		{},
	] },
	{ id: 'islands', lines: [
		{},
		{ keys: [ 'journal' ], touch: 'Journal' },
		{ keys: [ 'KeyM' ], touch: 'Map' },
		{}, {},
	] },
	{ id: 'trade', lines: [
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{}, {}, {},
	] },
	{ id: 'water', lines: [
		{ keys: [ 'jump' ], touch: 'Jump' },
		{ keys: [ 'dive' ], touch: 'Dive' },
		{ keys: [ 'KeyF' ], touch: 'Flare' },
		{}, {},
	] },
	// wave 20D: the navy, storm fronts, the walk-in towns (waves 19B / 19E)
	{ id: 'navy', lines: [
		{},
		{ keys: [ 'back' ], touch: 'Heave to' },
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{}, {},
	] },
	{ id: 'fronts', lines: [
		{},
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{}, {}, {},
	] },
	{ id: 'ashore', lines: [
		{},
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{ keys: [ 'interact' ], touch: 'Wide button' },
		{ keys: [ 'crew' ], touch: 'Crew' },
		{},
	] },
	{ id: 'multi', lines: [
		{}, {}, {},
		{ keys: [ 'emote' ], touch: 'Emote' },
	] },
];

// the text keys of a page (tests check that en.js and ro.js carry every one)
export function pageKeys( page ) {

	return [ `guide.${ page.id }.eyebrow`, `guide.${ page.id }.title`, ...page.lines.map( ( l, i ) => `guide.${ page.id }.${ i + 1 }` ) ];

}

// the one-time fishing tips (seen once per browser); `{ref}` is a key cap that follows the bindings
const TIPS = [ 'rodOut', 'nibble', 'fishOn', 'caught', 'full', 'boat', 'joe', 'marta' ];
export const TIP_KEYS = TIPS.map( ( id ) => `guide.tip.${ id }` );

const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );

// a key cap: the word 'Hold' is translated, everything else is a key the player has bound
export function capHTML( ref, a11y = null ) {

	return `<kbd>${ esc( ref === 'Hold' ? t( 'opt.hold', 'Hold' ) : controlKeyLabel( ref, a11y ) ) }</kbd>`;

}

// `{ref}` in a text -> the key cap ({n} and other non-key words stay)
export function fillCaps( text, a11y = null ) {

	return String( text ).replace( /\{(\w+)\}/g, ( m, ref ) => capHTML( ref, a11y ) );

}

// a page as HTML: rows with key caps (or the touch button), plain lines as paragraphs
export function pageHTML( page, { a11y = null, touch = false } = {} ) {

	const rows = page.lines.map( ( l, i ) => {

		const text = fillCaps( t( `guide.${ page.id }.${ i + 1 }` ), a11y );
		const lead = touch ? ( l.touch ? `<span class="gm-chip">${ esc( tx( l.touch ) ) }</span>` : '' ) : ( l.keys ? l.keys.map( ( k ) => capHTML( k, a11y ) ).join( '' ) : '' );
		return lead ? `<div class="gm-guide-row"><span class="k">${ lead }</span><span>${ text }</span></div>` : `<div class="gm-guide-row is-text"><span>${ text }</span></div>`;

	} );
	let html = `<div class="gm-guide-list">${ rows.join( '' ) }</div>`;
	if ( page.where ) {

		html += `<div class="gm-guide-where">
			<div class="is-joe"><i></i><span>${ t( 'guide.where.joe' ) }</span><em data-where="joe"></em></div>
			<div class="is-marta"><i></i><span>${ t( 'guide.where.marta' ) }</span><em data-where="marta"></em></div>
		</div><p class="gm-guide-note">${ t( 'guide.where.note' ) }</p>`;

	}

	return html;

}

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

// compass word for the direction from (x, z) to (tx, tz); north is -z
export function compassWord( x, z, tx, tz ) {

	const a = Math.atan2( tx - x, - ( tz - z ) ); // 0 north, clockwise
	const W = [ 'north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west' ];
	return W[ ( ( Math.round( a / ( Math.PI / 4 ) ) % 8 ) + 8 ) % 8 ];

}

export class Guide {

	constructor( ui, game, minimap = null ) {

		this.ui = ui;
		this.game = game;
		this.minimap = minimap;
		const style = h( 'style' );
		style.textContent = CSS;
		document.head.append( style );

		this.seen = this._load();
		this.el = h( 'div', 'gm-guide tw-interactive', `<div class="gm-guide-card tw-glass" role="dialog" aria-modal="true" aria-live="polite">
			<div class="gm-guide-eyebrow"></div><h2></h2><div class="gm-guide-body"></div>
			<div class="gm-guide-foot"><div class="gm-guide-dots">${ PAGES.map( () => '<span></span>' ).join( '' ) }</div>
			<div class="gm-guide-btns"><span class="gm-guide-hint"></span><button type="button" class="gm-btn is-ghost gm-guide-skip"></button><button type="button" class="gm-btn gm-guide-next"></button></div></div></div>` );
		this.card = this.el.firstChild;
		this.eyebrow = this.el.querySelector( '.gm-guide-eyebrow' );
		this.title = this.el.querySelector( 'h2' );
		this.body = this.el.querySelector( '.gm-guide-body' );
		this.dots = [ ...this.el.querySelectorAll( '.gm-guide-dots span' ) ];
		this.nextBtn = this.el.querySelector( '.gm-guide-next' );
		this.skipBtn = this.el.querySelector( '.gm-guide-skip' );
		this.hint = this.el.querySelector( '.gm-guide-hint' );
		this.skipBtn.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			this.close();

		} );
		this.nextBtn.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			this.next();

		} );
		ui.root.append( this.el );

		this.coach = h( 'div', 'gm-coach tw-glass', '<span class="gm-coach-x" aria-hidden="true">×</span><span class="gm-coach-eyebrow"></span><span class="gm-coach-text"></span>' );
		this.coach.setAttribute( 'role', 'status' );
		this.coachEyebrow = this.coach.querySelector( '.gm-coach-eyebrow' );
		this.coachText = this.coach.lastChild;
		// a click or a tap dismisses the tip (it never stands: ~7 s anyway)
		this.coach.addEventListener( 'pointerdown', ( e ) => {

			e.stopPropagation();
			this._hideCoach();

		} );
		( ui.hud || ui.root ).append( this.coach );

		this.open = false;
		this.step = 0;
		this._wait = this.seen.intro ? - 1 : 0.8; // seconds after the start overlay before the intro
		this._coachT = 0;
		this._queue = []; // [ { id, html, own } ]: own = a fishing tip (seen per browser); the others are their sender's
		this._whereT = 0;
		this._prev = { lastCatch: game.state.lastCatch };

		// while the intro is up it owns the keyboard and the mouse (capture phase, before the game's input)
		this._onKey = ( e ) => {

			if ( ! this.open ) return;
			if ( e.code === 'Escape' ) this.close();
			else if ( e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight' ) this.next();
			else if ( e.code === 'ArrowLeft' ) this.show( Math.max( 0, this.step - 1 ) );
			else if ( e.code !== 'F1' ) return;
			e.preventDefault();
			e.stopPropagation();

		};

		this._onDown = ( e ) => {

			if ( ! this.open ) return;
			if ( e.target && e.target.closest && e.target.closest( 'button' ) ) return;
			e.preventDefault();
			e.stopPropagation();
			this.next();

		};

		window.addEventListener( 'keydown', this._onKey, true );
		window.addEventListener( 'mousedown', this._onDown, true );

	}

	get a11y() {

		const app = this.game && this.game.app;
		return ( app && app.accessibility ) || null;

	}

	get touch() {

		const r = this.ui && this.ui.root;
		return !! ( r && r.classList && r.classList.contains( 'is-touch' ) );

	}

	_load() {

		try {

			return JSON.parse( localStorage.getItem( KEY ) || '{}' ) || {};

		} catch ( e ) {

			return {};

		}

	}

	_save() {

		try {

			localStorage.setItem( KEY, JSON.stringify( this.seen ) );

		} catch ( e ) { /* storage blocked: the guide just shows again next time */ }

	}

	// ---- intro
	show( i ) {

		this.step = i;
		const p = PAGES[ i ];
		this.eyebrow.textContent = t( `guide.${ p.id }.eyebrow` );
		this.title.textContent = t( `guide.${ p.id }.title` );
		this.body.innerHTML = pageHTML( p, { a11y: this.a11y, touch: this.touch } );
		this.body.scrollTop = 0;
		this.dots.forEach( ( d, j ) => d.classList.toggle( 'is-on', j === i ) );
		this.nextBtn.textContent = i === PAGES.length - 1 ? t( 'guide.done', 'Let\'s go' ) : t( 'guide.next', 'Next' );
		this.skipBtn.textContent = t( 'guide.skip', 'Skip' );
		this.hint.textContent = t( 'guide.hint', 'Enter · Esc to skip' );
		if ( this.minimap ) this.minimap.highlight( p.where ? [ 'joe', 'marta' ] : [] );
		this._whereT = 0;
		if ( ! this.open ) {

			this.open = true;
			this.el.classList.add( 'is-on' );
			// The opening click captures the pointer. Release it when this dialog
			// appears so Skip/Next receive clicks at their actual screen positions.
			try { if ( document.pointerLockElement ) document.exitPointerLock?.(); } catch { /* unavailable */ }

		}

	}

	next() {

		if ( this.step < PAGES.length - 1 ) this.show( this.step + 1 );
		else this.close();

	}

	close() {

		if ( ! this.open ) return;
		this.open = false;
		this.el.classList.remove( 'is-on' );
		if ( this.minimap ) this.minimap.highlight( [] );
		this.seen.intro = true;
		this._save();

	}

	replay() {

		this.seen = {};
		this._save();
		this._queue.length = 0;
		this._hideCoach();
		if ( this.ui.toggleHelp ) this.ui.toggleHelp( false );
		this.show( 0 );

	}

	// ---- one-time tips
	tip( id ) {

		if ( this.seen[ id ] || this._queued( id ) ) return;
		this._queue.push( { id, own: true } );

	}

	// a tip from elsewhere (game/Tips.js): shown in the same card, one at a time; the sender keeps its own seen state
	say( id, html ) {

		if ( ! html || this._queued( id ) ) return false;
		this._queue.push( { id, html, own: false } );
		return true;

	}

	_queued( id ) {

		return this._current === id || this._queue.some( ( q ) => q.id === id );

	}

	_hideCoach() {

		this._current = null;
		this.coach.classList.remove( 'is-on' );

	}

	update( dt ) {

		const ui = this.ui, g = this.game, app = g.app, p = app.player;

		// the controls sheet reads the key bindings from now on
		if ( ! this._bound && ui.bindControls && this.a11y ) {

			ui.bindControls( this.a11y );
			this._bound = true;

		}

		// the intro, once the start overlay is gone
		if ( this._wait >= 0 && ! ui._start ) {

			this._wait -= dt;
			if ( this._wait < 0 ) this.show( 0 );

		}

		if ( this.open ) {

			// live direction and distance to PoorGoat and Ethena
			this._whereT -= dt;
			if ( this._whereT <= 0 && PAGES[ this.step ].where ) {

				this._whereT = 0.25;
				const x = p.position.x, z = p.position.z;
				for ( const [ id, w ] of [ [ 'joe', STAND ], [ 'marta', CHANDLERY ] ] ) {

					const el = this.body.querySelector( `[data-where="${ id }"]` );
					const dir = compassWord( x, z, w.x, w.z );
					if ( el ) el.textContent = `${ Math.round( Math.hypot( w.x - x, w.z - z ) ) } m ${ t( `guide.dir.${ dir }`, dir ) }`;

				}

			}

			return;

		}

		// triggers (edge detected; each tip shows once)
		const rod = g.rod, b = g.bite, prev = this._prev;
		if ( rod.equipped && ! prev.equipped ) this.tip( 'rodOut' );
		if ( b && b.phase === 'nibble' ) this.tip( 'nibble' );
		if ( g.fight && ! prev.fight ) this.tip( 'fishOn' );
		const lc = g.state.lastCatch;
		if ( lc && lc !== prev.lastCatch && lc.kept ) this._afterCard = 'caught';
		if ( this._afterCard && ! ( g.hud && g.hud.catchOpen ) && ! g.landing ) {

			this.tip( this._afterCard );
			this._afterCard = null;

		}

		const s = g.state;
		if ( s.holdKg >= s.stats.holdKg * 0.92 ) this.tip( 'full' );
		if ( p.mode === 'walk' ) {

			const bt = app.boatCtl;
			if ( bt && s.boat && Math.hypot( bt.position.x - p.position.x, bt.position.z - p.position.z ) < 9 ) this.tip( 'boat' );
			for ( const v of g.vendors ) if ( v.inRange( p.position ) ) this.tip( v.kind === 'buyer' ? 'joe' : 'marta' );

		}

		prev.equipped = rod.equipped;
		prev.fight = !! g.fight;
		prev.lastCatch = lc;

		// the coach card: one tip at a time, ~7 s each (not over the catch card or a panel)
		const busy = g.hud && ( g.hud.catchOpen || g.hud.invOpen || g.hud.standOpen );
		if ( this._current ) {

			this._coachT -= dt;
			if ( this._coachT <= 0 || busy ) this._hideCoach();

		} else if ( this._queue.length && ! busy ) {

			const q = this._queue.shift();
			this._current = q.id;
			if ( q.own ) {

				this.seen[ q.id ] = true;
				this._save();

			}

			this.coachEyebrow.textContent = t( 'guide.tip', 'Tip' );
			this.coachText.innerHTML = q.own ? fillCaps( t( `guide.tip.${ q.id }` ), this.a11y ) : q.html;
			this.coach.classList.add( 'is-on' );
			this._coachT = 7.5;

		}

	}

}
