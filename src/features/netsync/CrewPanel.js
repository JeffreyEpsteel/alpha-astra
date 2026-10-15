// The Crew panel: your crew code to share, a field to join a friend's code, the crew list and the passenger switch.
//
//   openCrewPanel( app )     toggles it (the Online tab button calls this); same as app.features.get( 'netsync' ).openPanel()
//   panel.open() / close() / isOpen / refresh() / dispose()
//
// A plain DOM card in the HUD layer (class ns-crew); it refreshes twice a second while open, Escape closes it, and
// while it is open NetSync.isOpen() is true so Features.panelOpen() keeps the mouse off the rod.

const CSS = /* css */`
.ns-crew { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(92vw, 360px); padding: 16px 18px 14px;
	border-radius: 16px; background: rgba(12, 22, 30, 0.88); color: var(--tw-ink, #e8f1f5); font: 400 14px var(--tw-font, system-ui, sans-serif);
	box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45); backdrop-filter: blur(10px); pointer-events: auto; z-index: 60; }
.ns-crew h2 { margin: 0 0 10px; font-size: 16px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
.ns-crew .ns-x { cursor: pointer; opacity: 0.7; border: 0; background: none; color: inherit; font-size: 18px; line-height: 1; }
.ns-crew .ns-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.ns-crew .ns-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; margin-top: 12px; }
.ns-crew .ns-code { flex: 1; font: 700 26px ui-monospace, Consolas, monospace; letter-spacing: 0.22em; text-transform: uppercase; }
.ns-crew .ns-code.is-none { font: 400 14px var(--tw-font, system-ui, sans-serif); letter-spacing: 0; opacity: 0.6; }
.ns-crew button.ns-btn { cursor: pointer; border: 0; border-radius: 999px; padding: 6px 14px; font: 600 13px var(--tw-font, system-ui, sans-serif);
	background: var(--tw-aqua, #4fd1c5); color: #04202a; }
.ns-crew button.ns-btn[disabled] { opacity: 0.45; cursor: default; }
.ns-crew input[type=text] { flex: 1; min-width: 0; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.25);
	background: rgba(0, 0, 0, 0.3); color: inherit; font: 600 16px ui-monospace, Consolas, monospace; letter-spacing: 0.2em; text-transform: uppercase; }
.ns-crew .ns-msg { min-height: 16px; font-size: 12px; opacity: 0.85; }
.ns-crew .ns-msg.is-err { color: #ff9b8a; opacity: 1; }
.ns-crew ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 180px; overflow: auto; }
.ns-crew li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.ns-crew li .ns-tag { opacity: 0.65; font-size: 12px; white-space: nowrap; }
.ns-crew label.ns-check { display: flex; gap: 8px; align-items: center; margin-top: 12px; cursor: pointer; }
`;

let cssInjected = false;

const esc = ( s ) => String( s == null ? '' : s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );

export class CrewPanel {

	constructor( sync ) {

		this.sync = sync;
		this.el = null;
		this.isOpen = false;
		this._timer = 0;
		this._msg = '';
		this._err = false;
		this._busy = false;
		this._onKey = ( e ) => {

			if ( e.code === 'Escape' && this.isOpen ) {

				e.stopPropagation();
				this.close();

			}

		};

	}

	_root() {

		const app = this.sync.app;
		const ui = app.ui && app.ui.ui;
		return ( ui && ( ui.hud || ui.root ) ) || ( typeof document !== 'undefined' ? document.body : null );

	}

	open() {

		if ( this.isOpen || typeof document === 'undefined' ) return;
		if ( ! cssInjected ) {

			const style = document.createElement( 'style' );
			style.textContent = CSS;
			document.head.append( style );
			cssInjected = true;

		}

		const root = this._root();
		if ( ! root ) return;
		this.el = document.createElement( 'div' );
		this.el.className = 'ns-crew tw-glass';
		this.el.setAttribute( 'role', 'dialog' );
		this.el.setAttribute( 'aria-label', 'Crew' );
		root.append( this.el );
		this.isOpen = true;
		try {

			if ( document.exitPointerLock ) document.exitPointerLock();

		} catch ( e ) { /* not locked */ }

		document.addEventListener( 'keydown', this._onKey, true );
		this._build();
		this._timer = setInterval( () => this.refresh(), 500 );

	}

	close() {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		clearInterval( this._timer );
		document.removeEventListener( 'keydown', this._onKey, true );
		if ( this.el ) this.el.remove();
		this.el = null;

	}

	_build() {

		const el = this.el;
		el.innerHTML = `
			<h2><span>Crew</span><button class="ns-x" data-act="close" aria-label="Close">&times;</button></h2>
			<div class="ns-status" data-ref="status"></div>
			<div class="ns-label">Your crew code</div>
			<div class="ns-row"><div class="ns-code" data-ref="code"></div><button class="ns-btn" data-act="copy">Copy</button><button class="ns-btn" data-act="create">New crew</button></div>
			<div class="ns-label">Join a friend</div>
			<div class="ns-row"><input type="text" maxlength="6" placeholder="ABCDEF" spellcheck="false" autocomplete="off" data-ref="join" aria-label="Crew code"><button class="ns-btn" data-act="join">Join</button></div>
			<div class="ns-msg" data-ref="msg"></div>
			<div class="ns-label">On board</div>
			<ul data-ref="list"></ul>
			<label class="ns-check"><input type="checkbox" data-ref="open"> Take passengers on my boat</label>`;
		const q = ( r ) => el.querySelector( `[data-ref="${ r }"]` );
		this.refs = { status: q( 'status' ), code: q( 'code' ), join: q( 'join' ), msg: q( 'msg' ), list: q( 'list' ), open: q( 'open' ) };
		this.refs.open.checked = this.sync.openToGuests;
		this.refs.open.addEventListener( 'change', () => this.sync.setOpenToGuests( this.refs.open.checked ) );
		// typing here must not reach the game's key handling
		for ( const t of [ 'keydown', 'keyup', 'keypress' ] ) this.refs.join.addEventListener( t, ( e ) => { if ( e.code !== 'Escape' ) e.stopPropagation(); } );
		this.refs.join.addEventListener( 'keydown', ( e ) => { if ( e.code === 'Enter' ) this._join(); } );
		el.addEventListener( 'click', ( e ) => {

			const act = e.target && e.target.dataset ? e.target.dataset.act : null;
			if ( act === 'close' ) this.close();
			else if ( act === 'copy' ) this._copy();
			else if ( act === 'create' ) this._create();
			else if ( act === 'join' ) this._join();

		} );
		this.refresh();

	}

	_say( text, err = false ) {

		this._msg = text;
		this._err = err;
		if ( this.refs ) this._paintMsg();

	}

	_paintMsg() {

		this.refs.msg.textContent = this._msg;
		this.refs.msg.classList.toggle( 'is-err', this._err );

	}

	async _create() {

		if ( this._busy ) return;
		this._busy = true;
		this._say( 'Asking the server for a crew code...' );
		try {

			const code = await this.sync.createCrew();
			this._say( `Crew ${ code.toUpperCase() } is open. Send the code to your friends.` );

		} catch ( e ) {

			this._say( e.message || 'Could not create a crew', true );

		}

		this._busy = false;

	}

	async _join() {

		if ( this._busy ) return;
		const code = this.refs.join.value.trim();
		this._busy = true;
		try {

			await this.sync.joinCrew( code );
			this._say( `Joining ${ code.toUpperCase() }...` );
			this.refs.join.value = '';

		} catch ( e ) {

			this._say( e.message || 'Could not join', true );

		}

		this._busy = false;

	}

	async _copy() {

		const code = this.sync.crewCode;
		if ( ! code ) return this._say( 'No crew yet: press New crew', true );
		try {

			await navigator.clipboard.writeText( code.toUpperCase() );
			this._say( 'Copied' );

		} catch ( e ) {

			this._say( code.toUpperCase(), false );

		}

	}

	refresh() {

		if ( ! this.isOpen || ! this.refs ) return;
		const s = this.sync, net = s.net, r = this.refs;
		const code = s.crewCode;
		r.status.textContent = ! net ? 'Offline: pressing New crew or Join connects you to the server.'
			: ! net.online ? 'Connecting...'
				: `${ code ? 'In crew ' + code.toUpperCase() : 'In the public ' + ( net.room || 'island' ) + ' room' }${ s.isHost ? ' · you run the ships' : '' }`;
		r.code.textContent = code ? code.toUpperCase() : 'no crew yet';
		r.code.classList.toggle( 'is-none', ! code );
		const members = s.members();
		r.list.innerHTML = members.length ? members.map( ( m ) => {

			const tags = [];
			if ( m.host ) tags.push( 'ships' );
			if ( m.riding ) tags.push( `riding with ${ esc( s.nameOf( m.riding ) ) }` );
			else if ( m.aboard ) tags.push( `${ m.aboard } guest${ m.aboard > 1 ? 's' : '' }` );
			return `<li><span>${ esc( m.name ) }${ m.self ? ' (you)' : '' }</span><span class="ns-tag">${ tags.join( ' · ' ) }</span></li>`;

		} ).join( '' ) : '<li><span class="ns-tag">nobody yet</span></li>';
		if ( document.activeElement !== r.open ) r.open.checked = s.openToGuests;
		this._paintMsg();

	}

	dispose() {

		this.close();

	}

}
