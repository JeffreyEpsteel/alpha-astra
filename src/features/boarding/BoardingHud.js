// DOM of the boarding feature (class prefix bd-), laid over the game's HUD element like the melee and naval overlays:
//   - the Board prompt (bottom centre) while a crippled pirate lies alongside
//   - the surrender panel: "Take prisoner" / "Plunder" (keys 1 / 2, or click when the pointer is free)
//   - a black fade for the crossing and the return
//   - the prisoner counter (top left, only while there are prisoners)
//   - (wave 4) the beat bar of a hostile boarding fight: fills toward the next blow, gold at the end (the parry window)
// Everything is a no-op without a document or a HUD element (headless tests pass a fake `doc`).
//
//   const hud = new BoardingHud( { hud: hudElement, doc } );
//   hud.onChoose = ( index ) => ...
//   hud.update( dt, { prompt, choice: { title, lines: [ ... ], options: [ { key, label, sub, disabled } ] } | null, fade, prisoners: [ { name, value } ] } )
//   hud.dispose()

const CSS = /* css */`
.bd-root { position: absolute; left: 0; top: 0; right: 0; bottom: 0; pointer-events: none; overflow: hidden; }
.bd-prompt { position: absolute; left: 50%; bottom: calc(var(--tw-edge, 16px) + 120 * var(--tw-u, 1px)); transform: translateX(-50%); padding: calc(7 * var(--tw-u, 1px)) var(--tw-4, 16px);
	border-radius: 999px; background: var(--tw-glass, rgba(12, 18, 26, 0.62)); font: 600 var(--tw-fs-md, 12.5px) var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #eef6f8);
	white-space: nowrap; opacity: 0; transition: opacity 200ms ease; }
.bd-prompt.is-on { opacity: 1; }
.bd-prompt kbd, .bd-key { font: 700 var(--tw-fs-sm, 11.5px) var(--tw-mono, monospace); padding: 1px calc(6 * var(--tw-u, 1px)); border-radius: 5px; background: rgba(255, 255, 255, 0.16); margin-right: calc(6 * var(--tw-u, 1px)); }
.bd-choice { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(calc(420 * var(--tw-u, 1px)), calc(100vw - 2 * var(--tw-edge, 16px)));
	padding: var(--tw-4, 16px) var(--tw-5, 20px); border-radius: var(--tw-r-lg, 16px); background: var(--tw-glass, rgba(12, 18, 26, 0.72)); color: var(--tw-ink, #eef6f8);
	font: 500 var(--tw-fs-md, 12.5px) var(--tw-font, system-ui, sans-serif); opacity: 0; pointer-events: none; transition: opacity 240ms ease; }
.bd-choice.is-on { opacity: 1; pointer-events: auto; }
.bd-choice h3 { margin: 0 0 var(--tw-1, 4px); font-size: calc(16 * var(--tw-u, 1px)); font-weight: 650; }
.bd-choice p { margin: 0 0 var(--tw-3, 12px); color: var(--tw-ink-3, #9fb0b8); }
.bd-opt { display: flex; align-items: center; gap: var(--tw-2, 8px); width: 100%; text-align: left; margin-top: var(--tw-2, 8px); padding: calc(8 * var(--tw-u, 1px)) var(--tw-3, 12px);
	border: 1px solid var(--tw-line, rgba(255, 255, 255, 0.14)); border-radius: var(--tw-r-md, 10px); background: var(--tw-fill, rgba(255, 255, 255, 0.07)); color: inherit; font: inherit; cursor: pointer; }
.bd-opt:hover:not([disabled]) { background: var(--tw-fill-2, rgba(255, 255, 255, 0.14)); }
.bd-opt[disabled] { opacity: 0.4; cursor: default; }
.bd-opt b { display: block; font-weight: 650; }
.bd-opt small { display: block; color: var(--tw-ink-3, #9fb0b8); font-size: var(--tw-fs-sm, 11.5px); }
.bd-fade { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: #000; opacity: 0; }
.bd-count { position: absolute; left: var(--tw-edge, 16px); top: calc(var(--tw-edge, 16px) + 120 * var(--tw-u, 1px)); padding: calc(5 * var(--tw-u, 1px)) var(--tw-3, 12px); border-radius: 999px;
	background: var(--tw-glass, rgba(12, 18, 26, 0.62)); font: 600 var(--tw-fs-sm, 11.5px) var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #eef6f8); opacity: 0; transition: opacity 240ms ease; white-space: nowrap; }
.bd-count.is-on { opacity: 1; }
.bd-beat { position: absolute; left: 50%; bottom: calc(var(--tw-edge, 16px) + 104 * var(--tw-u, 1px)); width: calc(220 * var(--tw-u, 1px)); height: calc(6 * var(--tw-u, 1px));
	margin-left: calc(-110 * var(--tw-u, 1px)); border-radius: 99px; background: rgba(8, 12, 18, 0.6); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14); overflow: hidden; opacity: 0; transition: opacity 200ms ease; }
.bd-beat.is-on { opacity: 1; }
.bd-beat > i { position: absolute; right: 0; top: 0; bottom: 0; background: rgba(255, 200, 40, 0.55); }
.bd-beat > b { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgba(255, 255, 255, 0.85); }
.bd-beat.is-parried { box-shadow: 0 0 0 1px #ffd23a, 0 0 10px rgba(255, 200, 40, 0.8); }
.bd-beat.is-lost { box-shadow: 0 0 0 1px #ff5a4a; }
.bd-count b { color: var(--tw-sun, #ffb86b); font-family: var(--tw-mono, monospace); margin-right: calc(5 * var(--tw-u, 1px)); }
`;

let cssInjected = false;
export const esc = ( s ) => String( s == null ? '' : s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

export class BoardingHud {

	constructor( { hud = null, doc = ( typeof document !== 'undefined' ? document : null ) } = {} ) {

		this.doc = doc;
		this.hud = hud;
		this.root = null;
		this.onChoose = null;
		this._prompt = null;
		this._choiceKey = '';
		this._count = '';
		if ( ! doc || ! hud ) return;
		if ( ! cssInjected && doc.head ) {

			const style = doc.createElement( 'style' );
			style.textContent = CSS;
			doc.head.append( style );
			cssInjected = true;

		}

		const mk = ( tag, cls, html = '' ) => {

			const e = doc.createElement( tag );
			e.className = cls;
			if ( html ) e.innerHTML = html;
			return e;

		};

		this.mk = mk;
		this.root = mk( 'div', 'bd-root' );
		this.promptEl = mk( 'div', 'bd-prompt tw-glass' );
		this.choiceEl = mk( 'div', 'bd-choice tw-glass' );
		this.countEl = mk( 'div', 'bd-count tw-glass' );
		this.fadeEl = mk( 'div', 'bd-fade' );
		this.beatEl = mk( 'div', 'bd-beat', '<i></i><b></b>' );
		this.beatZone = this.beatEl.querySelector ? this.beatEl.querySelector( 'i' ) : null;
		this.beatFill = this.beatEl.querySelector ? this.beatEl.querySelector( 'b' ) : null;
		this.root.append( this.promptEl, this.choiceEl, this.countEl, this.beatEl, this.fadeEl );
		hud.append( this.root );

	}

	get enabled() {

		return !! this.root;

	}

	update( dt, view ) {

		if ( ! this.root ) return;
		const prompt = view.prompt || '';
		if ( prompt !== this._prompt ) {

			this._prompt = prompt;
			if ( prompt ) this.promptEl.innerHTML = prompt;
			this.promptEl.classList.toggle( 'is-on', !! prompt );

		}

		this._choice( view.choice );
		const beat = view.beat;
		if ( this.beatEl ) {

			this.beatEl.classList.toggle( 'is-on', !! beat );
			if ( beat ) {

				if ( this.beatFill ) this.beatFill.style.width = `${ ( beat.k * 100 ).toFixed( 1 ) }%`;
				if ( this.beatZone ) this.beatZone.style.width = `${ ( Math.min( 1, beat.zone ) * 100 ).toFixed( 1 ) }%`;
				this.beatEl.classList.toggle( 'is-parried', beat.last === 'parried' );
				this.beatEl.classList.toggle( 'is-lost', beat.last === 'lost' );

			}

		}
		const n = view.prisoners ? view.prisoners.length : 0;
		const label = n ? `<b>${ n }</b>Prisoner${ n > 1 ? 's' : '' } · ${ view.prisoners.map( ( p ) => esc( p.name ) ).join( ', ' ) }` : '';
		if ( label !== this._count ) {

			this._count = label;
			if ( label ) this.countEl.innerHTML = label;
			this.countEl.classList.toggle( 'is-on', n > 0 );

		}

		this.fadeEl.style.opacity = Math.max( 0, Math.min( 1, view.fade || 0 ) ).toFixed( 3 );

	}

	_choice( c ) {

		const key = c ? JSON.stringify( [ c.title, c.lines, c.options.map( ( o ) => [ o.label, o.sub, !! o.disabled ] ) ] ) : '';
		if ( key === this._choiceKey ) return;
		this._choiceKey = key;
		this.choiceEl.classList.toggle( 'is-on', !! c );
		if ( ! c ) return;
		this.choiceEl.innerHTML = `<h3>${ esc( c.title ) }</h3><p>${ c.lines.map( esc ).join( '<br>' ) }</p>`;
		c.options.forEach( ( o, i ) => {

			const b = this.mk( 'button', 'bd-opt', `<span class="bd-key">${ esc( o.key ) }</span><span><b>${ esc( o.label ) }</b><small>${ esc( o.sub ) }</small></span>` );
			if ( o.disabled ) b.disabled = true;
			b.addEventListener( 'click', () => { if ( ! o.disabled && this.onChoose ) this.onChoose( i ); } );
			this.choiceEl.append( b );

		} );

	}

	dispose() {

		if ( this.root && this.root.remove ) this.root.remove();
		this.root = null;

	}

}
