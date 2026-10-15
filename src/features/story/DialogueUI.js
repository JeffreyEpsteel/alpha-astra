// The conversation panel, in the look of the game HUD (ui/ui.css --tw-* tokens, .tw-glass, like the notice boards):
// the person's name, role, port and mood, what they say, and the player's numbered choices (click, or keys 1-9;
// Escape closes). The story section of the journal (J) is drawn here too and placed in the notices journal.
// The HTML is built by pure functions (dialogueHTML, journalHTML) so node tests can read it; the DOM is created only
// when a HUD exists (DialogueUI.create returns null headless).

const esc = ( v ) => String( v ?? '' ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );

const CSS = /* css */`
.sd-panel { position: absolute; left: 50%; bottom: calc(var(--tw-edge, 24px) + 40 * var(--tw-u)); transform: translate(-50%, 12px); width: calc(520 * var(--tw-u)); max-height: 62vh;
	display: flex; flex-direction: column; padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); }
.sd-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
.tw-root.is-photo .sd-panel { display: none; }
.sd-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--tw-3); margin-bottom: var(--tw-2); }
.sd-head h2 { margin: 0; font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.sd-head small { color: var(--tw-ink-3); font-size: var(--tw-fs-xs); letter-spacing: 0.1em; text-transform: uppercase; }
.sd-mood { color: var(--tw-aqua); }
.sd-mood.is-hostile, .sd-mood.is-wary { color: var(--tw-coral); }
.sd-mood.is-warm, .sd-mood.is-devoted { color: var(--tw-sun); }
.sd-line { margin: 0 0 var(--tw-3); line-height: 1.5; color: var(--tw-ink); }
.sd-line.is-said { color: var(--tw-ink); }
.sd-sub { margin: calc(-1 * var(--tw-2)) 0 var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); line-height: 1.45; }
.sd-sub em { font-style: normal; color: var(--tw-sun); }
.sd-choices { display: flex; flex-direction: column; gap: var(--tw-1); overflow: auto; }
.sd-choice { display: grid; grid-template-columns: auto 1fr; gap: var(--tw-2); align-items: baseline; text-align: left; font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	background: var(--tw-fill); border: 1px solid var(--tw-line); border-radius: var(--tw-r-md); padding: calc(6 * var(--tw-u)) var(--tw-3); cursor: pointer; }
.sd-choice:hover { border-color: rgba(var(--tw-aqua-rgb), 0.6); }
.sd-choice b { font-family: var(--tw-mono); color: var(--tw-ink-3); font-weight: 500; }
.sd-choice small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-xs); }
.sd-choice.is-turnin, .sd-choice.is-accept, .sd-choice.is-pick { border-color: rgba(var(--tw-sun-rgb), 0.55); }
.sd-choice.is-turnin span, .sd-choice.is-accept span, .sd-choice.is-pick span { color: var(--tw-sun); }
.sd-choice.is-offer span { color: var(--tw-aqua); }
.sd-choice.is-bye, .sd-choice.is-back { background: transparent; }
.sd-chain { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--tw-3); padding: var(--tw-2) 0; border-bottom: 1px solid var(--tw-line); }
.sd-chain .nb-bar { grid-column: 1 / -1; }
.sd-regions { display: flex; flex-wrap: wrap; gap: var(--tw-1) var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-xs); margin: var(--tw-1) 0; }
`;

export const REGION_NAMES = { home: 'Hyptile', pons: 'Pons Cove', gull: 'Gull Rock', key: 'Saltmarsh Key', sea: 'Open sea', tidemark: 'Tidemark', blackwater: 'Blackwater' };

// the open conversation
export function dialogueHTML( m ) {

	if ( ! m ) return '';
	const text = m.said || m.line;
	const sub = m.said && m.node === 'root' ? '' : m.hint ? `<p class="sd-sub">Now: <em>${ esc( m.hint ) }</em></p>` : m.reward ? `<p class="sd-sub">Reward: <em>${ esc( m.reward ) }</em></p>` : '';
	const choices = m.choices.map( ( c, i ) => `<button class="sd-choice is-${ esc( c.kind ) }" data-choice="${ esc( c.id ) }"${ c.disabled ? ' disabled' : '' }>
		<b>${ i < 9 ? i + 1 : '' }</b><span>${ esc( c.label ) }${ c.hint ? `<small>${ esc( c.hint ) }</small>` : '' }</span></button>` ).join( '' );
	return `<div class="sd-head"><h2>${ esc( m.name ) }</h2><small>${ esc( m.role ) } · ${ esc( m.portName ) } · <span class="sd-mood is-${ esc( m.mood ) }">${ esc( m.mood ) }</span></small></div>
		<p class="sd-line${ m.said ? ' is-said' : '' }">${ esc( text ) }</p>${ sub }
		<div class="sd-choices">${ choices }</div>`;

}

// the story part of the journal: running chains with their step, offers waiting, progress per region
export function journalHTML( j ) {

	if ( ! j ) return '';
	const act = j.active.map( ( a ) => `<div class="sd-chain"><div><div class="nb-title">${ esc( a.title ) }</div>
		<div class="nb-meta">${ esc( a.step ) }${ a.where ? ` · ${ esc( a.where ) }` : '' }</div></div><span class="nb-time">${ esc( a.giver ) }</span>
		${ a.frac > 0 ? `<div class="nb-bar"><span style="width:${ Math.round( a.frac * 100 ) }%"></span></div>` : '' }</div>` ).join( '' )
		|| '<div class="nb-empty">No quests running. Talk to the islanders: some of them have work.</div>';
	const offers = j.offers.map( ( o ) => `<div class="nb-act"><div class="nb-text">${ esc( o.giver ) } (${ esc( o.port ) }) has work: ${ esc( o.title ) }</div></div>` ).join( '' );
	const regions = Object.entries( j.regions ).map( ( [ r, g ] ) => `<span>${ esc( REGION_NAMES[ r ] || r ) } ${ g.done } / ${ g.total }</span>` ).join( '' );
	// the notes a finished quest leaves behind (wave 13: what opened, the parry tip)
	const notes = ( j.entries || [] ).map( ( e ) => `<div class="nb-act"><div><div class="nb-title">${ esc( e.title ) }</div><div class="nb-text">${ esc( e.text ) }</div></div></div>` ).join( '' );
	return `<div class="nb-sec">Quests · ${ j.done } of ${ j.total } done</div><div class="sd-regions">${ regions }</div>${ act }
		${ offers ? `<div class="nb-sec">Offers waiting</div>${ offers }` : '' }
		${ notes ? `<div class="nb-sec">Notes</div>${ notes }` : '' }`;

}

let styled = false;

export class DialogueUI {

	static create( story ) {

		if ( typeof document === 'undefined' ) return null;
		const app = story.app, g = app && app.game;
		const ui = ( g && g.hud && g.hud.ui ) || ( app && app.ui && app.ui.ui ) || null;
		if ( ! ui || ! ( ui.root || ui.hud ) ) return null;
		return new DialogueUI( story, ui );

	}

	constructor( story, ui ) {

		this.story = story;
		if ( ! styled && ! document.getElementById( 'sd-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'sd-style';
			style.textContent = CSS;
			document.head.append( style );
			styled = true;

		}

		this.panel = document.createElement( 'div' );
		this.panel.className = 'sd-panel tw-glass tw-interactive';
		( ui.root || ui.hud ).append( this.panel );
		this.isOpen = false;
		this.model = null;
		this._click = ( e ) => {

			const b = e.target.closest ? e.target.closest( '[data-choice]' ) : null;
			if ( b && this.model ) this.story.choose( this.model.npc, b.dataset.choice );

		};
		this.panel.addEventListener( 'click', this._click );
		// Escape closes, 1-9 pick a choice; swallowed so the game does not also react
		this._key = ( e ) => {

			if ( ! this.isOpen || e.repeat ) return;
			if ( e.code === 'Escape' ) {

				e.preventDefault();
				e.stopPropagation();
				this.story.close();

			} else if ( /^Digit[1-9]$/.test( e.code ) && this.model ) {

				const c = this.model.choices[ Number( e.code.slice( 5 ) ) - 1 ];
				if ( ! c ) return;
				e.preventDefault();
				e.stopPropagation();
				this.story.choose( this.model.npc, c.id );

			}

		};
		window.addEventListener( 'keydown', this._key, true );

	}

	open( model ) {

		this.isOpen = true;
		this.show( model );
		this.panel.classList.add( 'is-open' );
		try {

			if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock();

		} catch ( e ) { /* ignore */ }

	}

	show( model ) {

		this.model = model;
		this.panel.innerHTML = dialogueHTML( model );

	}

	close() {

		this.isOpen = false;
		this.model = null;
		this.panel.classList.remove( 'is-open' );

	}

	dispose() {

		window.removeEventListener( 'keydown', this._key, true );
		this.panel.removeEventListener( 'click', this._click );
		this.panel.remove();

	}

}
