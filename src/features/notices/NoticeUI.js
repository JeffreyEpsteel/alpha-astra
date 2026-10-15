import { CHARACTERS } from '../../game/Characters.js';
import { QuestJournal, journalCloseKey } from '../../ui/QuestJournal.js';
import { PORT_INFO, TYPE_LABEL, TIER_NAMES, STANDING, fmtLeft, fmtDistance, compassWord, progressText, regionText } from './NoticeData.js';

// DOM for the notice boards, in the look of the game HUD (ui/ui.css --tw-* tokens, .tw-glass, the gm-panel layout):
//   panel    the board of a port (E at the board) or the journal (J, anywhere): postings with timers, accept buttons,
//            the standing at both ports, what the keeper remembers, and the accepted notices with abandon
//   tracker  right side under the purse: the accepted notices with progress bars and time left (class prefix nb-)
// The HTML is built by pure functions (boardHTML, journalHTML, trackerHTML) so node tests can read it; the DOM
// is created only when a HUD exists (NoticeUI.create returns null headless).

const esc = ( v ) => String( v ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );
const money = ( v ) => `$${ Math.round( v ).toLocaleString() }`;
const stars = ( tier ) => '★'.repeat( tier ) + '☆'.repeat( Math.max( 0, 3 - tier ) );
const unlockName = ( id ) => ( CHARACTERS[ id ] ? CHARACTERS[ id ].name : id );

const CSS = /* css */`
.nb-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); width: calc(470 * var(--tw-u)); max-height: 80vh; display: flex; flex-direction: column;
	padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); }
.nb-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.tw-root.is-photo .nb-panel { display: none; }
.nb-panel h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.nb-sub { margin: 0 0 var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); line-height: 1.45; }
.nb-sub em { font-style: normal; color: var(--tw-sun); }
.nb-stand { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tw-3); margin: 0 0 var(--tw-3); }
.nb-rep { padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); background: var(--tw-fill); border: 1px solid var(--tw-line); }
.nb-rep.is-here { border-color: rgba(var(--tw-aqua-rgb), 0.5); }
.nb-rep-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--tw-2); }
.nb-rep-head b { font-weight: 600; }
.nb-rep-head span { font-size: var(--tw-fs-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--tw-aqua); }
.nb-bar { height: calc(5 * var(--tw-u)); margin-top: var(--tw-1); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.nb-bar > span { display: block; height: 100%; background: var(--tw-aqua); border-radius: inherit; transition: width var(--tw-med) var(--tw-ease); }
.nb-rep small { display: block; margin-top: 2px; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); }
.nb-list { overflow: auto; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2); }
.nb-sec { margin: var(--tw-3) 0 var(--tw-1); font-size: var(--tw-fs-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--tw-ink-3); }
.nb-card { display: grid; grid-template-columns: 1fr auto; gap: var(--tw-2) var(--tw-3); align-items: center; padding: var(--tw-3) 0; border-bottom: 1px solid var(--tw-line); }
.nb-card.is-bounty { padding-left: var(--tw-3); border-left: 2px solid var(--tw-sun); background: linear-gradient(90deg, rgba(var(--tw-sun-rgb), 0.07), transparent 70%); }
.nb-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--tw-2); }
.nb-tag { font-size: var(--tw-fs-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--tw-aqua); }
.is-bounty .nb-tag { color: var(--tw-sun); }
.nb-time { font-family: var(--tw-mono); font-size: var(--tw-fs-xs); color: var(--tw-ink-3); white-space: nowrap; }
.nb-time.is-low { color: var(--tw-coral); }
.nb-title { font-weight: 600; margin: 2px 0; }
.nb-text { color: var(--tw-ink-2); font-size: var(--tw-fs-sm); line-height: 1.45; }
.nb-meta { margin-top: var(--tw-1); color: var(--tw-ink-3); font-size: var(--tw-fs-xs); line-height: 1.4; }
.nb-side { display: flex; flex-direction: column; align-items: flex-end; gap: var(--tw-1); }
.nb-reward { font-family: var(--tw-mono); color: var(--tw-sun); font-size: var(--tw-fs-lg); white-space: nowrap; }
.nb-reward small { display: block; text-align: right; font-family: var(--tw-font); font-size: var(--tw-fs-xs); color: var(--tw-ink-3); }
.nb-reward small.is-unlock { color: var(--tw-aqua); }
.nb-btn { font: 600 var(--tw-fs-md) var(--tw-font); color: #0b1418; background: var(--tw-aqua); border: 0; border-radius: 999px; padding: calc(5 * var(--tw-u)) var(--tw-4); cursor: pointer; }
.nb-btn[disabled] { opacity: 0.4; cursor: default; }
.nb-btn.is-ghost { background: var(--tw-fill-2); color: var(--tw-ink); }
.nb-empty { color: var(--tw-ink-3); padding: var(--tw-3) 0; text-align: center; font-size: var(--tw-fs-sm); }
.nb-foot { display: flex; justify-content: space-between; align-items: center; margin-top: var(--tw-3); gap: var(--tw-3); }
.nb-foot span { color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.nb-act { display: grid; grid-template-columns: 1fr auto; gap: var(--tw-2); align-items: center; padding: var(--tw-2) 0; border-bottom: 1px solid var(--tw-line); }
.nb-act .nb-title { margin: 0; }

.nb-tracker { position: absolute; right: calc(var(--tw-3) + 56 * var(--tw-u)); top: calc(var(--tw-edge) + 52 * var(--tw-u)); width: calc(250 * var(--tw-u)); display: flex; flex-direction: column; gap: var(--tw-2);
	padding: var(--tw-3) var(--tw-4); border-radius: var(--tw-r-md); font: 500 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink); pointer-events: none;
	transition: right var(--tw-slow) var(--tw-ease); }
.tw-root[data-panel='open'] .nb-tracker { right: calc(var(--tw-panel-w) + 2 * var(--tw-3) + 56 * var(--tw-u)); }
.tw-root.is-photo .nb-tracker, .nb-tracker.is-empty { display: none; }
.nb-t-head { display: flex; justify-content: space-between; font-size: var(--tw-fs-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--tw-ink-3); }
.nb-t-item { display: flex; flex-direction: column; gap: 3px; }
.nb-t-title { font-weight: 600; line-height: 1.3; }
.nb-t-item.is-bounty .nb-t-title { color: var(--tw-sun); }
.nb-t-sub { display: flex; justify-content: space-between; gap: var(--tw-2); font-family: var(--tw-mono); font-size: var(--tw-fs-xs); color: var(--tw-ink-3); }
.nb-t-sub .is-low { color: var(--tw-coral); }
.nb-t-item .nb-bar { margin-top: 0; }
.nb-t-item.is-bounty .nb-bar > span { background: var(--tw-sun); }
`;

// ---------------------------------------------------------------- HTML (pure)

function repBox( s, info, here ) {

	const prev = STANDING[ s.level ].min, span = s.next === null ? 1 : s.next - prev;
	const frac = s.next === null ? 1 : ( s.value - prev ) / span;
	const hint = s.next === null ? 'Top of the board' : `${ Math.ceil( s.next - s.value ) } more for ${ s.nextName }`;
	return `<div class="nb-rep${ here ? ' is-here' : '' }"><div class="nb-rep-head"><b>${ esc( info.short ) }</b><span>${ esc( s.name ) }</span></div>
		<div class="nb-bar"><span style="width:${ Math.round( frac * 100 ) }%"></span></div><small>${ esc( hint ) }</small></div>`;

}

function timeHTML( exp, hours, cls = 'nb-time' ) {

	const left = exp - hours;
	return `<span class="${ cls }${ left < 4 ? ' is-low' : '' }" data-exp="${ exp }">${ left < 0 ? 'lapsed' : fmtLeft( left ) + ' left' }</span>`;

}

export function cardHTML( p, m ) {

	const bounty = p.kind === 'bounty', full = m.active.length >= m.max;
	const rw = p.reward;
	const tag = bounty ? `Wanted · ${ stars( p.tier ) }` : TYPE_LABEL[ p.type ] || 'Notice';
	const title = bounty ? p.target : p.title;
	const meta = bounty
		? `${ esc( TIER_NAMES[ p.tier ] ) } · last known ${ esc( regionText( p ) ) } · ${ esc( p.client ) }`
		: esc( p.client );
	return `<div class="nb-card${ bounty ? ' is-bounty' : '' }" data-id="${ esc( p.id ) }">
		<div><div class="nb-head"><span class="nb-tag">${ esc( tag ) }</span>${ timeHTML( p.expires, m.hours ) }</div>
			<div class="nb-title">${ esc( title ) }</div><div class="nb-text">${ esc( p.text ) }</div><div class="nb-meta">${ meta }</div></div>
		<div class="nb-side"><div class="nb-reward">${ money( rw.money ) }<small>+${ Math.round( rw.rep ) } standing</small>${ rw.unlock ? `<small class="is-unlock">${ esc( unlockName( rw.unlock ) ) } may join you</small>` : '' }</div>
			<button class="nb-btn" data-accept="${ esc( p.id ) }" ${ full ? 'disabled title="You can carry three notices at a time"' : '' }>${ bounty ? 'Take contract' : 'Accept' }</button></div></div>`;

}

export function activeRowHTML( n, m ) {

	const bounty = n.kind === 'bounty';
	return `<div class="nb-act" data-id="${ esc( n.id ) }"><div><div class="nb-title">${ esc( bounty ? n.target : n.title ) }</div>
		<div class="nb-meta">${ esc( progressText( n ) ) } · ${ bounty ? esc( regionText( n ) ) + ' · ' : '' }${ timeHTML( n.expires, m.hours ) } · ${ esc( PORT_INFO[ n.port ].short ) } board</div></div>
		<button class="nb-btn is-ghost" data-abandon="${ esc( n.id ) }">Drop</button></div>`;

}

function standHTML( m, here ) {

	return `<div class="nb-stand">${ repBox( m.standing.home, PORT_INFO.home, here === 'home' ) }${ repBox( m.standing.pons, PORT_INFO.pons, here === 'pons' ) }</div>`;

}

// the board of m.port
export function boardHTML( m ) {

	const g = m.greeting;
	const cards = m.postings.map( ( p ) => cardHTML( p, m ) ).join( '' ) || '<div class="nb-empty">Nothing is pinned up right now. Check back at the next tide.</div>';
	const act = m.active.map( ( n ) => activeRowHTML( n, m ) ).join( '' );
	return `<h2>${ esc( m.info.name ) } · notice board</h2>
		<p class="nb-sub"><em>${ esc( g.keeper ) }:</em> ${ esc( g.line ) }${ g.note ? ` ${ esc( g.note ) }` : '' }</p>
		${ standHTML( m, m.port ) }
		<div class="nb-list"><div class="nb-sec">Posted · ${ m.postings.length } notice${ m.postings.length === 1 ? '' : 's' }</div>${ cards }
		${ act ? `<div class="nb-sec">Your notices · ${ m.active.length } of ${ m.max }</div>${ act }` : '' }</div>
		<div class="nb-foot"><span>Day ${ m.day + 1 } · times are in-game hours</span>${ m.talk ? `<button class="nb-btn" data-talk="${ esc( m.talk.npc ) }">Talk to ${ esc( m.talk.name ) }${ m.talk.work ? ' · work' : '' }</button>` : '' }<button class="nb-btn is-ghost" data-close>Close (E)</button></div>`;

}

// the journal (J): accepted notices, standing, recent outcomes
export function journalHTML( m, notes = [], stats = null ) {

	const act = m.active.map( ( n ) => activeRowHTML( n, m ) ).join( '' ) || '<div class="nb-empty">No notices taken. Read a notice board at Hyptile or Pons Cove.</div>';
	const recent = notes.slice( 0, 4 ).map( ( x ) => `<div class="nb-act"><div class="nb-text">${ esc( x.title ) }</div><span class="nb-time">${ esc( { done: 'done', expired: 'lapsed', abandoned: 'dropped', beaten: 'taken by another' }[ x.outcome ] || x.outcome ) }</span></div>` ).join( '' );
	return `<h2>Journal</h2>
		<p class="nb-sub">${ m.active.length } of ${ m.max } notices taken${ stats ? ` · ${ stats.completed } done, ${ stats.failed } failed, ${ stats.bounties } bounties` : '' }</p>
		${ standHTML( m, null ) }
		<div class="nb-list">${ m.storyHTML || '' }<div class="nb-sec">Your notices</div>${ act }${ recent ? `<div class="nb-sec">Recent</div>${ recent }` : '' }</div>
		<div class="nb-foot"><span>Notices lapse as in-game hours pass</span><button class="nb-btn is-ghost" data-close>Close (J)</button></div>`;

}

// where a bounty's last known region is: from the player when known ('south-west 1.2 km', 'search here' inside 150 m),
// else from the harbour that posted it
export function whereText( n, from = null ) {

	if ( ! n.region ) return '';
	if ( from && Number.isFinite( from.x ) && Number.isFinite( from.z ) ) {

		const dx = n.region.x - from.x, dz = n.region.z - from.z, d = Math.hypot( dx, dz );
		return d < 150 ? 'search here' : `${ compassWord( dx, dz ) } ${ fmtDistance( d ) }`;

	}

	return `${ n.region.compass } ${ fmtDistance( n.region.distance ) }`;

}

// the tracker: accepted notices with progress (from: the player's { x, z }, for the bounties' bearings)
export function trackerHTML( active, hours, max, from = null ) {

	if ( ! active.length ) return '';
	const items = active.map( ( n ) => {

		const bounty = n.kind === 'bounty';
		const frac = Math.max( 0, Math.min( 1, n.progress / n.goal ) );
		const left = n.expires - hours;
		return `<div class="nb-t-item${ bounty ? ' is-bounty' : '' }" data-id="${ esc( n.id ) }"><div class="nb-t-title">${ esc( bounty ? `Wanted: ${ n.captain }` : n.title ) }</div>
			<div class="nb-bar"><span style="width:${ Math.round( frac * 100 ) }%"></span></div>
			<div class="nb-t-sub"><span>${ esc( bounty ? whereText( n, from ) : progressText( n ) ) }</span><span class="nb-t-left${ left < 4 ? ' is-low' : '' }">${ left <= 0 ? 'lapsed' : fmtLeft( left ) }</span></div></div>`;

	} ).join( '' );
	return `<div class="nb-t-head"><span>Notices</span><span>${ active.length } / ${ max }</span></div>${ items }`;

}

// ---------------------------------------------------------------- DOM

let styled = false;

export class NoticeUI {

	// null when there is no DOM or no HUD yet (node, the loader)
	static create( notices ) {

		if ( typeof document === 'undefined' ) return null;
		const app = notices.app, g = app && app.game;
		const ui = ( g && g.hud && g.hud.ui ) || ( app && app.ui && app.ui.ui ) || null;
		if ( ! ui || ! ( ui.root || ui.hud ) ) return null;
		return new NoticeUI( notices, ui );

	}

	constructor( notices, ui ) {

		this.n = notices;
		this.ui = ui;
		if ( ! styled && ! document.getElementById( 'nb-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'nb-style';
			style.textContent = CSS;
			document.head.append( style );
			styled = true;

		}

		this.panel = document.createElement( 'div' );
		this.panel.className = 'nb-panel tw-glass tw-interactive';
		this.tracker = document.createElement( 'div' );
		this.tracker.className = 'nb-tracker tw-glass is-empty';
		( ui.root || ui.hud ).append( this.panel );
		( ui.hud || ui.root ).append( this.tracker );
		this.isOpen = false;
		this.view = 'board';
		this.port = 'home';
		this._t = 0;
		this._sig = '';
		this._trackerHTML = null;
		this.questJournal = new QuestJournal( notices, this );
		this._click = ( e ) => this._onClick( e );
		this.panel.addEventListener( 'click', this._click );
		// Escape, E (and J in the journal) close it; swallowed so the game does not also react to the key
		this._key = ( e ) => {

			if ( ! this.isOpen ) return;
			if ( ( this.view === 'journal' && journalCloseKey( e ) ) || e.code === 'Escape' || ( ! e.repeat && e.code === 'KeyE' && this.view === 'board' ) ) {

				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				this.close();

			}

		};
		window.addEventListener( 'keydown', this._key, true );
		this.refresh();

	}

	open( view, port ) {

		this.view = view === 'journal' ? 'journal' : 'board';
		this.panel.classList.toggle( 'qj-panel', this.view === 'journal' );
		this.panel.setAttribute?.( 'role', 'dialog' );
		this.panel.setAttribute?.( 'aria-modal', 'true' );
		this.panel.setAttribute?.( 'aria-label', this.view === 'journal' ? 'Quest journal' : 'Notice board' );
		this.port = PORT_INFO[ port ] ? port : 'home';
		this.isOpen = true;
		this._sig = '';
		this.render();
		this.panel.classList.add( 'is-open' );
		if ( this.view === 'journal' ) this.panel.querySelector?.( '[data-qj-select],[data-close]' )?.focus?.();
		try {

			if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock();

		} catch ( e ) { /* ignore */ }

	}

	close() {

		this.isOpen = false;
		this.panel.classList.remove( 'is-open' );

	}

	render() {

		if ( this.view === 'journal' ) { this.questJournal.render( true ); return; }
		const m = this.n.model( this.port );
		this._sig = m.postings.map( ( p ) => p.id ).join( ',' ) + '|' + m.active.map( ( a ) => a.id + a.progress ).join( ',' ) + '|' + ( m.storyHTML || '' ).length;
		this.panel.innerHTML = this.view === 'journal' ? journalHTML( m, this.n.notes, this.n.stats ) : boardHTML( m );

	}

	refresh() {

		this._renderTracker();
		if ( this.isOpen ) this.render();

	}

	_renderTracker() {

		const active = this.n.active, p = this.n.app && this.n.app.player && this.n.app.player.position;
		const html = trackerHTML( active, this.n.hours, 3, p ? { x: p.x, z: p.z } : null );
		if ( html !== this._trackerHTML ) {

			this._trackerHTML = html;
			this.tracker.innerHTML = html;

		}

		this.tracker.classList.toggle( 'is-empty', ! active.length );

	}

	// every second: the timers, and a re-render when postings lapsed under the panel
	update( dt ) {

		this._t += dt;
		if ( this._t < 1 ) return;
		this._t = 0;
		const hours = this.n.hours;
		if ( this.isOpen ) {

			if ( this.view === 'journal' ) this.questJournal.render();
			const m = this.n.model( this.port );
			const sig = m.postings.map( ( p ) => p.id ).join( ',' ) + '|' + m.active.map( ( a ) => a.id + a.progress ).join( ',' ) + '|' + ( m.storyHTML || '' ).length;
			if ( this.view !== 'journal' && sig !== this._sig ) this.render();

		}

		for ( const el of this.panel.querySelectorAll( '[data-exp]' ) ) {

			const left = + el.dataset.exp - hours;
			el.textContent = left <= 0 ? 'lapsed' : `${ fmtLeft( left ) } left`;
			el.classList.toggle( 'is-low', left < 4 );

		}

		this._renderTracker(); // the timers and the bounties' bearings move

	}

	_onClick( e ) {

		if ( this.view === 'journal' && this.questJournal.click( e ) ) return;
		const t = e.target.closest ? e.target.closest( '[data-accept],[data-abandon],[data-close],[data-talk]' ) : null;
		if ( ! t ) return;
		if ( t.hasAttribute( 'data-close' ) ) this.close();
		else if ( t.dataset.talk ) {

			// the board keeper (src/features/story): the conversation replaces the board
			const story = this.n.features.get && this.n.features.get( 'story' );
			this.close();
			if ( story && story.talkTo ) story.talkTo( t.dataset.talk, { force: true } );

		}
		else if ( t.dataset.accept ) {

			if ( ! this.n.accept( t.dataset.accept ) && this.n.lastError ) this.n._toast( this.n.lastError, 2600 );

		} else if ( t.dataset.abandon ) this.n.abandon( t.dataset.abandon );

	}

	dispose() {

		window.removeEventListener( 'keydown', this._key, true );
		this.panel.removeEventListener( 'click', this._click );
		this.panel.remove();
		this.tracker.remove();

	}

}
