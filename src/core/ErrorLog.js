// Error log: a ring buffer of the page's errors (window errors, failed resource loads, unhandled promise rejections,
// console.error and console.warn) with an in-game viewer and a copy button. Nothing leaves the browser: the player
// copies the text into a bug report if they want to.
//
//   const log = installErrorLog();        // once, as early as possible (main.js); also window.__errors
//   log.entries -> [ { t, kind: 'error' | 'rejection' | 'resource' | 'console' | 'warn', message, stack, source, count } ]
//   log.push( kind, message, { stack, source } )   log.clear()   log.text() (what Copy copies)   log.onChange( fn )
//   log.errorCount                          entries that are not warnings
//   log.open() / close() / toggle() / isOpen     the viewer (F8 in every mode; the sandbox debug panel has a button)
//
// The same message again within the last few entries bumps its count instead of a new line. The viewer is a plain
// DOM panel (no engine), built on first open.

export const CAPACITY = 60;
const DEDUPE = 8; // entries searched for a repeat
const MAX_TEXT = 2000; // characters kept of a message / stack

const CSS = /* css */`
.elog { position: absolute; right: var(--tw-4, 16px); top: var(--tw-4, 16px); z-index: 40; width: min(620px, calc(100% - 32px)); max-height: min(70vh, 640px);
	display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px; color: var(--tw-ink, #eef6f8);
	font: 500 13px var(--tw-font, system-ui, sans-serif); background: rgba(6, 16, 24, 0.92); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); }
.elog[hidden] { display: none; }
.elog-head { display: flex; align-items: center; gap: 8px; }
.elog-title { flex: 1; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; }
.elog button { font: inherit; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
.elog button:hover { background: rgba(255, 255, 255, 0.16); }
.elog-list { overflow: auto; display: flex; flex-direction: column; gap: 6px; min-height: 40px; }
.elog-row { padding: 6px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.04); }
.elog-row.is-warn { opacity: 0.8; }
.elog-meta { color: var(--tw-ink-3, #9fb3bd); font-size: 11px; font-family: var(--tw-mono, ui-monospace, monospace); }
.elog-kind { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 6px; background: rgba(255, 122, 133, 0.25); }
.elog-row.is-warn .elog-kind { background: rgba(255, 200, 90, 0.22); }
.elog-msg { white-space: pre-wrap; word-break: break-word; margin-top: 2px; }
.elog-row details { margin-top: 4px; }
.elog-row pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; font: 11px var(--tw-mono, ui-monospace, monospace); color: var(--tw-ink-3, #9fb3bd); }
.elog-empty { color: var(--tw-ink-3, #9fb3bd); padding: 8px; }
.elog-note { min-height: 1.2em; font-size: 12px; color: var(--tw-aqua, #5fe3d4); }
`;

const clip = ( s ) => {

	s = typeof s === 'string' ? s : s === undefined ? '' : String( s );
	return s.length > MAX_TEXT ? s.slice( 0, MAX_TEXT ) + '…' : s;

};

// a readable message from anything thrown or logged
export function describe( v ) {

	if ( v instanceof Error ) return { message: `${ v.name || 'Error' }: ${ v.message }`, stack: v.stack || '' };
	if ( v && typeof v === 'object' ) {

		if ( typeof v.message === 'string' ) return { message: v.message, stack: typeof v.stack === 'string' ? v.stack : '' };
		try { return { message: JSON.stringify( v ), stack: '' }; } catch ( e ) { return { message: String( v ), stack: '' }; }

	}

	return { message: String( v ), stack: '' };

}

export class ErrorLog {

	constructor( { capacity = CAPACITY, now = () => Date.now() } = {} ) {

		this.capacity = capacity;
		this.now = now;
		this.entries = [];
		this.total = 0; // every push, repeats included
		this._fns = new Set();
		this._undo = [];
		this.el = null;
		this.isOpen = false;
		this.root = null; // where the viewer goes (default document.body)

	}

	get errorCount() {

		let n = 0;
		for ( const e of this.entries ) if ( e.kind !== 'warn' ) n ++;
		return n;

	}

	push( kind, message, { stack = '', source = '' } = {} ) {

		message = clip( message );
		stack = clip( stack );
		this.total ++;
		const t = this.now();
		for ( let i = this.entries.length - 1; i >= Math.max( 0, this.entries.length - DEDUPE ); i -- ) {

			const e = this.entries[ i ];
			if ( e.kind === kind && e.message === message ) {

				e.count ++;
				e.last = t;
				this._changed();
				return e;

			}

		}

		const entry = { t, last: t, kind, message, stack, source: clip( source ), count: 1 };
		this.entries.push( entry );
		if ( this.entries.length > this.capacity ) this.entries.splice( 0, this.entries.length - this.capacity );
		this._changed();
		return entry;

	}

	clear() {

		this.entries = [];
		this._changed();

	}

	onChange( fn ) {

		this._fns.add( fn );
		return () => this._fns.delete( fn );

	}

	_changed() {

		for ( const fn of [ ...this._fns ] ) {

			try { fn( this ); } catch ( e ) { /* never log from the logger */ }

		}

		if ( this.isOpen ) this._render();

	}

	// plain text for a bug report
	text( { header = true } = {} ) {

		const lines = [];
		if ( header ) {

			const nav = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
			const href = typeof location !== 'undefined' ? location.href.split( '?' )[ 0 ] : '';
			lines.push( `Hyptile Island error log · ${ new Date( this.now() ).toISOString() }`, nav, href, '' );

		}

		for ( const e of this.entries ) {

			lines.push( `[${ new Date( e.t ).toISOString() }] ${ e.kind }${ e.count > 1 ? ` x${ e.count }` : '' }: ${ e.message }` );
			if ( e.source ) lines.push( `  at ${ e.source }` );
			if ( e.stack ) lines.push( e.stack.split( '\n' ).map( ( l ) => '    ' + l.trim() ).join( '\n' ) );

		}

		if ( ! this.entries.length ) lines.push( '(no errors)' );
		return lines.join( '\n' );

	}

	// ---- capture
	install( { target = typeof window !== 'undefined' ? window : null, console: con = typeof console !== 'undefined' ? console : null, warn = true, key = 'F8' } = {} ) {

		this.uninstall();
		if ( target && target.addEventListener ) {

			const onError = ( ev ) => {

				// a failed <script> / <img> / <link> load arrives here with the element as the target (capture phase)
				const el = ev && ev.target;
				if ( el && el !== target && ( el.src || el.href ) ) {

					this.push( 'resource', `failed to load ${ el.tagName ? el.tagName.toLowerCase() : 'resource' }`, { source: el.src || el.href } );
					return;

				}

				const d = ev && ev.error ? describe( ev.error ) : { message: ( ev && ev.message ) || 'error', stack: '' };
				const src = ev && ev.filename ? `${ ev.filename }:${ ev.lineno || 0 }:${ ev.colno || 0 }` : '';
				this.push( 'error', d.message, { stack: d.stack, source: src } );

			};

			const onRejection = ( ev ) => {

				const d = describe( ev ? ev.reason : 'rejection' );
				this.push( 'rejection', d.message, { stack: d.stack } );

			};

			const onKey = ( ev ) => {

				if ( ! key || ev.code !== key || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey ) return;
				const t = ev.target;
				if ( t && ( t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ) ) return;
				if ( ev.preventDefault ) ev.preventDefault();
				this.toggle();

			};

			target.addEventListener( 'error', onError, true );
			target.addEventListener( 'unhandledrejection', onRejection );
			target.addEventListener( 'keydown', onKey );
			this._undo.push( () => {

				target.removeEventListener( 'error', onError, true );
				target.removeEventListener( 'unhandledrejection', onRejection );
				target.removeEventListener( 'keydown', onKey );

			} );

		}

		if ( con ) {

			const wrap = ( name, kind ) => {

				const orig = con[ name ];
				if ( typeof orig !== 'function' ) return;
				const self = this;
				con[ name ] = function ( ...args ) {

					try {

						const err = args.find( ( a ) => a instanceof Error );
						const message = args.map( ( a ) => ( a instanceof Error ? `${ a.name }: ${ a.message }` : typeof a === 'string' ? a : describe( a ).message ) ).join( ' ' );
						self.push( kind, message, { stack: err ? err.stack || '' : '' } );

					} catch ( e ) { /* never break logging */ }

					return orig.apply( this, args );

				};

				this._undo.push( () => { con[ name ] = orig; } );

			};

			wrap( 'error', 'console' );
			if ( warn ) wrap( 'warn', 'warn' );

		}

		return this;

	}

	uninstall() {

		for ( const f of this._undo.splice( 0 ) ) f();

	}

	// ---- the viewer
	open() {

		if ( typeof document === 'undefined' ) return false;
		if ( ! this.el ) this._build();
		this.el.hidden = false;
		this.isOpen = true;
		this._render();
		// the mouse is needed for the buttons
		try { if ( document.pointerLockElement ) document.exitPointerLock(); } catch ( e ) { /* ignore */ }
		return true;

	}

	close() {

		if ( this.el ) this.el.hidden = true;
		this.isOpen = false;

	}

	toggle() {

		return this.isOpen ? ( this.close(), false ) : this.open();

	}

	_build() {

		if ( ! document.getElementById( 'elog-style' ) ) {

			const st = document.createElement( 'style' );
			st.id = 'elog-style';
			st.textContent = CSS;
			document.head.append( st );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'elog tw-interactive';
		el.setAttribute( 'role', 'dialog' );
		el.setAttribute( 'aria-label', 'Error log' );
		el.hidden = true;
		el.innerHTML = `<div class="elog-head"><span class="elog-title">Error log</span>
			<button type="button" data-a="copy">Copy</button><button type="button" data-a="clear">Clear</button><button type="button" data-a="close" aria-label="Close">✕</button></div>
			<div class="elog-note" aria-live="polite"></div><div class="elog-list"></div>`;
		for ( const t of [ 'pointerdown', 'mousedown', 'click', 'wheel' ] ) el.addEventListener( t, ( e ) => e.stopPropagation(), { passive: true } );
		el.addEventListener( 'click', ( e ) => {

			const b = e.target.closest && e.target.closest( 'button[data-a]' );
			if ( ! b ) return;
			const a = b.dataset.a;
			if ( a === 'close' ) this.close();
			else if ( a === 'clear' ) this.clear();
			else if ( a === 'copy' ) this.copy();

		} );
		( this.root || ( document.querySelector( '.tw-root' ) ) || document.body ).append( el );

	}

	async copy() {

		const text = this.text();
		let ok = false;
		try {

			if ( navigator.clipboard && navigator.clipboard.writeText ) {

				await navigator.clipboard.writeText( text );
				ok = true;

			}

		} catch ( e ) { /* fall back below */ }

		if ( ! ok && typeof document !== 'undefined' ) {

			const ta = document.createElement( 'textarea' );
			ta.value = text;
			ta.style.cssText = 'position:fixed;left:-9999px;top:0';
			document.body.append( ta );
			ta.select();
			try { ok = document.execCommand( 'copy' ); } catch ( e ) { ok = false; }
			ta.remove();

		}

		const note = this.el && this.el.querySelector( '.elog-note' );
		if ( note ) {

			note.textContent = ok ? 'Copied to the clipboard' : 'Copy failed: select the text below by hand';
			clearTimeout( this._noteT );
			this._noteT = setTimeout( () => { note.textContent = ''; }, 2400 );

		}

		return ok;

	}

	_render() {

		if ( ! this.el ) return;
		const list = this.el.querySelector( '.elog-list' );
		const esc = ( s ) => String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ c ] ) );
		if ( ! this.entries.length ) {

			list.innerHTML = '<div class="elog-empty">No errors so far.</div>';
			return;

		}

		list.innerHTML = this.entries.slice().reverse().map( ( e ) => `<div class="elog-row${ e.kind === 'warn' ? ' is-warn' : '' }">
			<div class="elog-meta"><span class="elog-kind">${ esc( e.kind ) }${ e.count > 1 ? ' ×' + e.count : '' }</span>${ esc( new Date( e.t ).toLocaleTimeString() ) }${ e.source ? ' · ' + esc( e.source ) : '' }</div>
			<div class="elog-msg">${ esc( e.message ) }</div>${ e.stack ? `<details><summary class="elog-meta">stack</summary><pre>${ esc( e.stack ) }</pre></details>` : '' }</div>` ).join( '' );

	}

	dispose() {

		this.uninstall();
		if ( this.el ) this.el.remove();
		this.el = null;
		this._fns.clear();

	}

}

let shared = null;

// the page's log (installed once); window.__errors for the console
export function installErrorLog( opts = {} ) {

	if ( shared ) return shared;
	shared = new ErrorLog( opts ).install( opts );
	if ( typeof window !== 'undefined' ) window.__errors = shared;
	return shared;

}

export function errorLog() {

	return shared;

}
