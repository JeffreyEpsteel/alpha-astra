import { PORT_INFO, progressText, fmtLeft } from '../features/notices/NoticeData.js';
import { STAND } from '../game/FishStand.js';
import { CAMP } from '../features/melee/MeleeData.js';

const esc = ( v ) => String( v ?? '' ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
const point = ( p, label ) => p && Number.isFinite( p.x ) && Number.isFinite( p.z ) ? { x: p.x, z: p.z, label: label || p.label || 'Objective' } : null;

// One model for the journal and tracking. Positions come from live quest data; a
// fishing task without a fixed location deliberately has no invented destination.
export function questJournalModel( app, features ) {

	const rows = [], story = features?.get?.( 'story' ), notices = features?.get?.( 'notices' );
	const journal = story?.journal?.() || {};
	for ( const q of journal.active || [] ) rows.push( {
		id: 'story:' + q.id, source: 'Story', title: q.title, text: q.step, where: q.where || q.port,
		frac: q.frac, target: point( story.pinOf?.( q.id ) ), note: 'Complete the current objective to advance this story.',
	} );
	for ( const q of notices?.active || [] ) {

		if ( Number.isFinite( q.expires ) && q.expires <= notices.hours ) continue;
		const dest = PORT_INFO[ q.params?.port ];
		const target = q.kind === 'bounty' ? point( q.region, 'Last known search area' )
			: dest ? point( dest.anchor, dest.name ) : q.type === 'shoreRaider' ? point( CAMP, 'Raider camp' ) : null;
		rows.push( { id: 'notice:' + q.id, source: q.kind === 'bounty' ? 'Bounty' : 'Notice', title: q.title || q.target,
			noticeId: q.id,
			text: q.text, where: target?.label || PORT_INFO[ q.port ]?.name || '', frac: q.goal ? q.progress / q.goal : 0,
			progress: progressText( q ), target, note: Number.isFinite( q.expires ) ? `${ fmtLeft( q.expires - notices.hours ) } left · completes automatically when its objective is met.` : '',
		} );

	}
	for ( const q of app?.game?.contracts?.active || [] ) {

		if ( q.kind === 'chain' ) continue; // already listed once, independently of the nearby vendor
		rows.push( { id: 'contract:' + q.id, source: q.kind === 'order' ? 'Fish order' : 'Fishing', title: q.title,
			text: q.text, where: q.done ? 'PoorGoat · Hyptile Harbour' : 'Follow the fishing conditions in the objective.',
			frac: q.goal ? q.progress / q.goal : 0, progress: `${ q.progress } / ${ q.goal }`,
			target: q.done ? point( STAND, 'PoorGoat · claim reward' ) : null,
			note: q.done ? 'Ready to hand in. Visit PoorGoat and use the Quests tab.' : 'Catch progress is recorded automatically. Return to PoorGoat when ready.',
		} );

	}
	return { rows, entries: journal.entries || [], offers: journal.offers || [], recent: [ ...( journal.log || [] ), ...( notices?.notes || [] ) ].slice( 0, 6 ) };

}

export function questJournalHTML( model, selected, tracked ) {

	const q = model.rows.find( ( r ) => r.id === selected );
	const rows = model.rows.map( ( r ) => `<button type="button" class="qj-row${ r.id === selected ? ' is-selected' : '' }" data-qj-select="${ esc( r.id ) }" aria-pressed="${ r.id === selected }"><small>${ esc( r.source ) }${ r.id === tracked ? ' · TRACKED' : '' }</small><b>${ esc( r.title ) }</b><span>${ esc( r.progress || r.text ) }</span></button>` ).join( '' );
	const pct = Math.max( 0, Math.min( 100, Number( q?.frac || 0 ) * 100 ) );
	const detail = q ? `<small class="qj-eyebrow">${ esc( q.source ) } · CURRENT OBJECTIVE</small><h3>${ esc( q.title ) }</h3><p class="qj-objective">${ esc( q.text ) }</p><div class="nb-bar"><span style="width:${ pct.toFixed( 0 ) }%"></span></div><p class="qj-place">${ esc( q.where ) }</p><p class="qj-note">${ esc( q.note ) }</p>${ ! q.target ? '<p class="qj-note">This objective has no fixed map location. Its conditions are shown above.</p>' : '' }<div class="qj-actions"><button type="button" class="nb-btn" data-qj-map ${ q.target ? '' : 'disabled' }>Show on map ↗</button><button type="button" class="nb-btn is-ghost" data-qj-track>${ q.id === tracked ? 'Untrack' : 'Track quest' }</button>${ q.noticeId ? `<button type="button" class="nb-btn is-ghost" data-abandon="${ esc( q.noticeId ) }">Drop notice</button>` : '' }</div>` : '<div class="qj-empty"><b>Your next voyage starts here.</b><p>Select a quest to read its current objective and chart its destination.</p></div>';
	const offers = model.offers.map( ( r ) => `<p><b>${ esc( r.title ) }</b><br>${ esc( r.giver ) } · ${ esc( r.port ) }</p>` ).join( '' );
	const notes = model.entries.map( ( r ) => `<p><b>${ esc( r.title ) }</b><br>${ esc( r.text ) }</p>` ).join( '' );
	const recent = model.recent.map( ( r ) => `<p>${ esc( r.title ) } · ${ esc( r.outcome ) }</p>` ).join( '' );
	return `<header class="qj-head"><div><small class="qj-eyebrow">CAPTAIN'S LOG</small><h2>Quest Journal</h2><p>${ model.rows.length } active · Select a quest to chart your course</p></div><button type="button" class="nb-btn is-ghost" data-close aria-label="Close quest journal">Close (J)</button></header><div class="qj-layout"><nav class="qj-list" aria-label="Active quests">${ rows || '<p class="qj-note">No active quests. Speak to harbour residents or read a notice board.</p>' }</nav><section class="qj-detail" aria-label="Selected quest">${ detail }</section></div>${ offers || notes || recent ? `<details class="qj-notes"><summary>Leads, completed voyages & notes</summary>${ offers }${ notes }${ recent }</details>` : '' }`;

}

export function journalCloseKey( e ) {

	return e.code === 'Escape' || ( e.code === 'KeyJ' && ! e.repeat );

}

export class QuestJournal {

	constructor( notices, owner ) {

		this.n = notices;
		this.owner = owner;
		this._sig = '';
		if ( typeof document !== 'undefined' && ! document.getElementById( 'qj-style' ) ) {

			const style = document.createElement( 'style' ); style.id = 'qj-style'; style.textContent = CSS; document.head.append( style );

		}

	}
	get map() { return this.n.features?.get?.( 'worldmap' ); }
	render( force = false ) {

		const model = questJournalModel( this.n.app, this.n.features ), map = this.map;
		map?.reconcileQuests?.( model.rows );
		const html = questJournalHTML( model, map?.selectedQuest, map?.trackedQuest );
		if ( force || html !== this._sig ) {

			this._sig = html;
			const focused = this.owner.panel.contains?.( document.activeElement ) ? document.activeElement?.getAttribute?.( 'data-qj-select' ) : null;
			this.owner.panel.innerHTML = html;
			if ( focused ) [ ...this.owner.panel.querySelectorAll( '[data-qj-select]' ) ].find( ( e ) => e.dataset.qjSelect === focused )?.focus();

		}

	}
	click( e ) {

		const button = e.target.closest?.( '[data-qj-select],[data-qj-map],[data-qj-track]' );
		if ( ! button ) return false;
		const map = this.map;
		if ( button.hasAttribute( 'data-qj-select' ) ) map?.selectQuest?.( button.dataset.qjSelect );
		else if ( button.hasAttribute( 'data-qj-track' ) ) map?.trackQuest?.( map.selectedQuest === map.trackedQuest ? null : map.selectedQuest );
		else if ( button.hasAttribute( 'data-qj-map' ) ) {

			if ( map?.showQuest?.( map.selectedQuest ) ) this.owner.close();

		}
		this.render();
		return true;

	}

}

const CSS = `
.nb-panel.qj-panel { width:min(920px,calc(100vw - 32px)); max-height:86vh; padding:24px; z-index:44; background:linear-gradient(135deg,rgba(13,35,43,.97),rgba(7,20,29,.98)); border:1px solid #65847b; box-shadow:0 28px 100px #0009; }
.qj-head { display:flex; justify-content:space-between; gap:12px; align-items:center; padding-bottom:16px; border-bottom:1px solid #8bc7b42b; }
.qj-eyebrow { color:#e2c58b; font-size:10px; letter-spacing:.18em; }
.qj-head h2 { font-size:25px; margin:6px 0; font-weight:500; }.qj-head p,.qj-note { color:#a3b8bc; font-size:12px; line-height:1.6; margin:6px 0; }
.qj-layout { display:grid; grid-template-columns:minmax(200px, .85fr) minmax(0,1.4fr); min-height:280px; overflow:auto; }
.qj-list { display:flex; flex-direction:column; gap:6px; overflow:auto; padding:16px 16px 16px 0; max-height:48vh; border-right:1px solid #8bc7b42b; }
.qj-row { appearance:none; display:flex; flex-direction:column; text-align:left; gap:6px; border:1px solid transparent; border-radius:8px; padding:12px; color:#eff4e9; background:#ffffff05; cursor:pointer; font:inherit; }
.qj-row:hover { background:#ffffff0c; }.qj-row:focus-visible,.qj-actions button:focus-visible { outline:2px solid #f3d38d; outline-offset:2px; }
.qj-row.is-selected { background:linear-gradient(100deg,#8cbdab29,#c2ae6920); border-color:#dfc88a7a; box-shadow:inset 3px 0 #e7c887; }
.qj-row small { color:#9dbdae; font-size:9px; letter-spacing:.1em; text-transform:uppercase; }.qj-row b { font-size:14px; font-weight:600; }.qj-row span { font-size:11px; color:#b1c2c4; line-height:1.5; }
.qj-detail { padding:24px; min-width:0; }.qj-detail h3 { font-size:25px; font-weight:500; margin:12px 0 20px; color:#f6edce; }.qj-objective { font-size:15px; line-height:1.7; color:#dbe7e4; }.qj-place { color:#e5c78b; font-size:13px; margin-top:20px; }.qj-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:24px; }.qj-actions button { min-height:40px; }.qj-empty { margin:40px 0; color:#b4c9c8; line-height:1.7; }
.qj-notes { border-top:1px solid #8bc7b42b; padding:12px 0 0; overflow:auto; font-size:12px; color:#b4c9c8; line-height:1.6; }.qj-notes summary { cursor:pointer; color:#dfc890; }.qj-notes p { padding:4px 0; }.qj-notes b { color:#e4e9df; }
@media(max-width:600px) { .nb-panel.qj-panel { padding:16px; }.qj-head h2 { font-size:21px; }.qj-layout { grid-template-columns:1fr; }.qj-list { max-height:24vh; border-right:0; border-bottom:1px solid #8bc7b42b; padding-right:0; }.qj-detail { padding:16px 2px; }.qj-detail h3 { margin:8px 0; font-size:22px; }.qj-actions { margin-top:14px; }.qj-head .nb-btn { min-height:40px; } }
`;
