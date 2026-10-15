import { SaveVault, inspectSlots, unwrapSave, wrapExport, validateSave } from '../game/SaveVault.js';
import { SLOTS } from '../game/GameState.js';
import { MODES, MODE_IDS, modeLabel, isMode, isOnlineSession } from '../game/GameMode.js';
import { CHARACTERS } from '../game/Characters.js';
import { BOATS } from '../game/Boats.js';
import { levelFor } from '../game/Progression.js';

// The save manager: every local slot of each mode with its mode, date, money and health, and the tools around it:
// export to a .json file, import one (validated before anything is written), duplicate onto another slot, delete
// (with a confirm; the save is backed up first so it can come back), and restore any of the slot's rolling backups.
// In the persistent universe the captain's server profile gets its own row: export it, or copy it into a local slot.
//
//   const saves = new SaveManager( { app } );   // or as a feature: features.add( 'saves', SaveManagerModule )
//   saves.open( { mode } ) / close() / toggle() / isOpen      (Escape closes; the root opens it from the pause and main menus)
//   saves.refresh()
//
// Slots are always the browser's own (localStorage), whatever the running game's storage is. A change to the slot
// being played (import, restore, duplicate onto it) reloads that slot in place (app.startSession); deleting it is
// refused while it is being played. While the game runs on a hosted universe (state.storage.universe) the save
// lives on the server: the panel is read-only for the local slots (export still works) and the server row is labelled
// "Universe (server)". Messages go to the panel's note line (and nowhere else: no standing prompts).

const CSS = /* css */`
.svm { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; padding: var(--tw-5, 20px); overflow: auto;
	background: rgba(3, 10, 16, 0.6); font: 500 var(--tw-fs-md, 14px) var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #eef6f8); }
.svm[hidden] { display: none; }
.svm-card { width: min(760px, 100%); max-height: 100%; overflow: auto; padding: var(--tw-5, 20px) var(--tw-6, 24px); border-radius: var(--tw-r-lg, 14px);
	display: flex; flex-direction: column; gap: 10px; background: rgba(8, 20, 30, 0.9); }
.svm-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.svm-title { flex: 1; font-size: 18px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; }
.svm button { font: inherit; font-size: 13px; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 8px; padding: 5px 10px; cursor: pointer; }
.svm button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
.svm button:disabled { opacity: 0.4; cursor: default; }
.svm button.is-on { background: rgba(95, 227, 212, 0.25); border-color: rgba(95, 227, 212, 0.6); }
.svm button.is-danger { background: rgba(255, 122, 133, 0.22); border-color: rgba(255, 122, 133, 0.5); }
.svm-modes { display: flex; gap: 6px; }
.svm-row { padding: 10px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.04); display: flex; flex-direction: column; gap: 6px; }
.svm-row.is-current { box-shadow: inset 0 0 0 1px rgba(95, 227, 212, 0.55); }
.svm-row.is-bad { box-shadow: inset 0 0 0 1px rgba(255, 122, 133, 0.6); }
.svm-info { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.svm-info b { font-weight: 600; }
.svm-dim { color: var(--tw-ink-3, #9fb3bd); font-size: 12px; }
.svm-warn { color: #ffb4bb; font-size: 12px; }
.svm-actions, .svm-sub { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.svm-sub { padding-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.svm-note { min-height: 1.3em; font-size: 13px; color: var(--tw-aqua, #5fe3d4); white-space: pre-wrap; }
.svm-note.is-bad { color: #ffb4bb; }
.svm-server { padding: 10px 12px; border-radius: 10px; background: rgba(95, 227, 212, 0.08); display: flex; flex-direction: column; gap: 6px; }
`;

const esc = ( s ) => String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ c ] ) );
const money = ( v ) => '$' + Math.round( v || 0 ).toLocaleString( 'en-US' );

export function playTime( s ) {

	s = Math.max( 0, s | 0 );
	const h = Math.floor( s / 3600 ), m = Math.floor( ( s % 3600 ) / 60 );
	return h ? `${ h }h ${ m }m` : `${ m }m`;

}

export function dateText( t ) {

	if ( ! t ) return 'never';
	const d = new Date( t );
	return d.toLocaleDateString( undefined, { day: 'numeric', month: 'short' } ) + ' ' + d.toLocaleTimeString( undefined, { hour: '2-digit', minute: '2-digit' } );

}

// the export file name: hyptile-campaign-slot2-2026-10-12.json
export function exportName( mode, slot, t = Date.now() ) {

	const d = new Date( t );
	const p = ( n ) => String( n ).padStart( 2, '0' );
	return `hyptile-${ isMode( mode ) ? mode : 'save' }-${ slot === null || slot === undefined ? 'server' : 'slot' + ( slot + 1 ) }-${ d.getFullYear() }-${ p( d.getMonth() + 1 ) }-${ p( d.getDate() ) }.json`;

}

function localStorageSafe() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}

export class SaveManager {

	constructor( { app = null, root = null, storage = localStorageSafe(), slots = SLOTS } = {} ) {

		this.app = app;
		this.root = root;
		this.storage = storage;
		this.slots = slots;
		this.vault = new SaveVault( () => this.storage );
		this.mode = ( app && isMode( app.mode ) ) ? app.mode : 'campaign';
		this.isOpen = false;
		this.el = null;
		this._expand = null; // { slot, what: 'delete' | 'backups' | 'dup' | 'server' }
		this._importSlot = null;

	}

	get state() {

		return this.app && this.app.game ? this.app.game.state : null;

	}

	// the slot being played, when a session is running
	get active() {

		const app = this.app, st = this.state;
		if ( ! app || ! st || ! app.session ) return null;
		return { mode: st.mode, slot: st.slot };

	}

	// a hosted universe holds the save: no local slot writes while it is attached
	get readOnly() {

		const st = this.state;
		return isOnlineSession( this.app ) || !! ( st && st.storage && st.storage.universe );

	}

	wantsMouse() {

		return this.isOpen;

	}

	open( { mode = null } = {} ) {

		if ( typeof document === 'undefined' ) return false;
		if ( isMode( mode ) ) this.mode = mode;
		else if ( this.app && isMode( this.app.mode ) ) this.mode = this.app.mode;
		if ( ! this.el ) this._build();
		this._expand = null;
		this.el.hidden = false;
		this.isOpen = true;
		this._note( '' );
		this.refresh();
		try { if ( document.pointerLockElement ) document.exitPointerLock(); } catch ( e ) { /* ignore */ }
		return true;

	}

	close() {

		if ( this.el ) this.el.hidden = true;
		this.isOpen = false;
		this._expand = null;

	}

	toggle() {

		return this.isOpen ? ( this.close(), false ) : this.open();

	}

	_build() {

		if ( ! document.getElementById( 'svm-style' ) ) {

			const st = document.createElement( 'style' );
			st.id = 'svm-style';
			st.textContent = CSS;
			document.head.append( st );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'svm tw-interactive';
		el.hidden = true;
		el.innerHTML = `<div class="svm-card tw-glass" role="dialog" aria-modal="true" aria-label="Saves">
			<div class="svm-head"><span class="svm-title">Saves</span><div class="svm-modes"></div><button type="button" data-a="close" aria-label="Close">✕</button></div>
			<div class="svm-server" hidden></div><div class="svm-list"></div><div class="svm-note" aria-live="polite"></div></div>
			<input type="file" accept=".json,application/json" hidden>`;
		for ( const t of [ 'pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'touchstart' ] ) el.addEventListener( t, ( e ) => e.stopPropagation(), { passive: true } );
		el.addEventListener( 'contextmenu', ( e ) => { e.stopPropagation(); e.preventDefault(); } );
		el.addEventListener( 'click', ( e ) => this._click( e ) );
		el.addEventListener( 'keydown', ( e ) => {

			if ( e.code === 'Escape' ) {

				e.stopPropagation();
				e.preventDefault();
				this.close();

			}

		} );
		this.fileInput = el.querySelector( 'input[type=file]' );
		this.fileInput.addEventListener( 'change', () => this._fileChosen() );
		const ui = this.app && this.app.ui && this.app.ui.ui;
		( this.root || ( ui && ui.root ) || document.body ).append( el );

	}

	_note( text, bad = false ) {

		const n = this.el && this.el.querySelector( '.svm-note' );
		if ( ! n ) return;
		n.textContent = text;
		n.classList.toggle( 'is-bad', !! bad );

	}

	refresh() {

		if ( ! this.el ) return;
		const modes = this.el.querySelector( '.svm-modes' );
		modes.innerHTML = MODE_IDS.map( ( id ) => `<button type="button" data-a="mode" data-mode="${ id }" class="${ id === this.mode ? 'is-on' : '' }">${ esc( MODES[ id ].name ) }</button>` ).join( '' );
		const rows = this.rows = inspectSlots( this.storage, this.mode, this.slots );
		this._renderServer();
		const act = this.active;
		const list = this.el.querySelector( '.svm-list' );
		list.innerHTML = rows.map( ( r ) => this._rowHTML( r, act && act.mode === this.mode && act.slot === r.slot ) ).join( '' );

	}

	_rowHTML( r, current ) {

		const ex = this._expand && this._expand.slot === r.slot ? this._expand.what : null;
		const head = `<b>Slot ${ r.slot + 1 }</b>${ current ? ' <span class="svm-dim">(playing)</span>' : '' }`;
		let info;
		if ( ! r.exists ) info = `${ head }<span class="svm-dim">Empty</span>`;
		else {

			const ch = CHARACTERS[ r.character ];
			const boat = r.boat && BOATS[ r.boat ] ? BOATS[ r.boat ].name : 'on foot';
			const problems = r.report && ! r.report.ok ? `<span class="svm-warn" title="${ esc( r.report.errors.map( ( e ) => `${ e.path || 'save' }: ${ e.msg }` ).join( '\n' ) ) }">${ r.report.errors.length } problem${ r.report.errors.length > 1 ? 's' : '' }: loads from a backup</span>` : '';
			info = `${ head }${ r.name ? `<span>${ esc( r.name ) }</span>` : '' }<span>${ esc( ch ? ch.name : r.character ) }</span><span>${ esc( modeLabel( r.mode || this.mode ) ) }</span>
				<span>Lv ${ levelFor( r.xp || 0 ) }</span><span>${ money( r.money ) }</span><span class="svm-dim">${ esc( boat ) } · ${ playTime( r.playSeconds ) } · saved ${ esc( dateText( r.savedAt ) ) }</span>${ problems }`;

		}

		const nb = r.backups.length;
		const ro = this.readOnly ? 'disabled title="Read-only while playing on the universe"' : '';
		const actions = `<button type="button" data-a="export" data-slot="${ r.slot }" ${ r.exists ? '' : 'disabled' }>Export</button>
			<button type="button" data-a="import" data-slot="${ r.slot }" ${ ro }>Import</button>
			<button type="button" data-a="dup" data-slot="${ r.slot }" ${ r.exists && r.ok && ! ro ? '' : 'disabled' } class="${ ex === 'dup' ? 'is-on' : '' }">Duplicate</button>
			<button type="button" data-a="backups" data-slot="${ r.slot }" ${ nb ? '' : 'disabled' } class="${ ex === 'backups' ? 'is-on' : '' }">Backups (${ nb })</button>
			<button type="button" data-a="delete" data-slot="${ r.slot }" ${ r.exists && ! current && ! ro ? '' : 'disabled' } ${ current ? 'title="This slot is being played"' : '' }>Delete</button>`;
		let sub = '';
		if ( ex === 'delete' ) sub = `<span>Delete slot ${ r.slot + 1 }? A backup is kept: Restore brings it back.</span>
			<button type="button" class="is-danger" data-a="delete-yes" data-slot="${ r.slot }">Delete</button><button type="button" data-a="cancel">Cancel</button>`;
		else if ( ex === 'dup' ) sub = '<span>Copy to</span>' + this.rows.filter( ( o ) => o.slot !== r.slot ).map( ( o ) => `<button type="button" data-a="dup-to" data-slot="${ r.slot }" data-to="${ o.slot }">Slot ${ o.slot + 1 }${ o.exists ? ' (replace)' : '' }</button>` ).join( '' ) + '<button type="button" data-a="cancel">Cancel</button>';
		else if ( ex === 'backups' ) sub = r.backups.map( ( b ) => `<span class="svm-dim">#${ b.i } · ${ money( b.money ) } · Lv ${ levelFor( b.xp || 0 ) } · ${ esc( dateText( b.savedAt ) ) }${ b.ok ? '' : ' · damaged' }</span>
			<button type="button" data-a="restore" data-slot="${ r.slot }" data-i="${ b.i }" ${ b.ok && ! ro ? '' : 'disabled' }>Restore</button>` ).join( '' ) + '<button type="button" data-a="cancel">Close</button>';
		return `<div class="svm-row${ current ? ' is-current' : '' }${ r.exists && ! r.ok ? ' is-bad' : '' }"><div class="svm-info">${ info }</div><div class="svm-actions">${ actions }</div>${ sub ? `<div class="svm-sub">${ sub }</div>` : '' }</div>`;

	}

	// the universe's captain profile (kept by the server): export, or copy into a local slot
	_serverProfile() {

		const st = this.state;
		const u = ( this.app && this.app.universe ) || ( st && st.storage && st.storage.universe && typeof st.storage.universe === 'object' ? st.storage.universe : null );
		if ( ! u || typeof u.json !== 'string' || ! u.json ) return null;
		const u2 = unwrapSave( u.json );
		return u2 ? { captain: u.captain || '', json: u.json, save: u2.save } : null;

	}

	_renderServer() {

		const box = this.el.querySelector( '.svm-server' );
		const p = this._serverProfile();
		box.hidden = ! p;
		if ( ! p ) return;
		const r = validateSave( p.save );
		const ex = this._expand && this._expand.what === 'server';
		box.innerHTML = `<div class="svm-info"><b>Universe (server)</b><span>${ esc( p.captain ) }</span><span>Lv ${ levelFor( p.save.xp || 0 ) }</span><span>${ money( p.save.money ) }</span>
			<span class="svm-dim">kept by the server${ r.ok ? '' : ' · ' + r.errors.length + ' problem(s)' }</span></div>
			<div class="svm-actions"><button type="button" data-a="server-export">Export</button><button type="button" data-a="server-copy" class="${ ex ? 'is-on' : '' }" ${ this.readOnly ? 'disabled title="Read-only while playing on the universe"' : '' }>Copy to a local slot</button></div>
			${ ex ? `<div class="svm-sub"><span>${ esc( MODES[ this.mode ].name ) } slot:</span>${ this.rows ? this.rows.map( ( o ) => `<button type="button" data-a="server-to" data-to="${ o.slot }">Slot ${ o.slot + 1 }${ o.exists ? ' (replace)' : '' }</button>` ).join( '' ) : '' }<button type="button" data-a="cancel">Cancel</button></div>` : '' }`;

	}

	_click( e ) {

		const b = e.target.closest && e.target.closest( 'button[data-a]' );
		if ( ! b || b.disabled ) return;
		const a = b.dataset.a, slot = b.dataset.slot !== undefined ? Number( b.dataset.slot ) : null;
		switch ( a ) {

			case 'close': this.close(); return;
			case 'mode': this.mode = b.dataset.mode; this._expand = null; break;
			case 'cancel': this._expand = null; break;
			case 'export': this.exportSlot( slot ); return;
			case 'import': this._importSlot = slot; this.fileInput.value = ''; this.fileInput.click(); return;
			case 'dup': case 'backups': case 'delete': this._expand = this._expand && this._expand.slot === slot && this._expand.what === a ? null : { slot, what: a }; break;
			case 'delete-yes': this.deleteSlot( slot ); this._expand = null; break;
			case 'dup-to': this.duplicate( slot, Number( b.dataset.to ) ); this._expand = null; break;
			case 'restore': this.restore( slot, Number( b.dataset.i ) ); this._expand = { slot, what: 'backups' }; break;
			case 'server-export': this.exportServer(); return;
			case 'server-copy': this._expand = this._expand && this._expand.what === 'server' ? null : { slot: - 1, what: 'server' }; break;
			case 'server-to': this.copyServerTo( Number( b.dataset.to ) ); this._expand = null; break;

		}

		this.refresh();

	}

	_key( slot, mode = this.mode ) {

		return SaveVault.keyOf( slot, mode );

	}

	// a slot of the running session changed underneath it: load it in place
	_changed( slot, mode = this.mode ) {

		const act = this.readOnly ? null : this.active;
		if ( ! act || act.slot !== slot || act.mode !== mode ) return false;
		const app = this.app;
		if ( app && typeof app.startSession === 'function' ) {

			try { app.startSession( { mode, slot } ); } catch ( e ) { console.error( e ); }
			return true;

		}

		return false;

	}

	_download( text, name ) {

		try {

			const blob = new Blob( [ text ], { type: 'application/json' } );
			const url = URL.createObjectURL( blob );
			const a = document.createElement( 'a' );
			a.href = url;
			a.download = name;
			document.body.append( a );
			a.click();
			a.remove();
			setTimeout( () => URL.revokeObjectURL( url ), 1000 );
			return true;

		} catch ( e ) {

			return false;

		}

	}

	_refuse() {

		this._note( 'Local saves are read-only during multiplayer. Leave the online session before importing, restoring or changing slots.', true );
		return { ok: false, errors: [ { path: '', msg: 'read-only during multiplayer' } ], warnings: [] };

	}

	exportSlot( slot ) {

		// the slot being played: write it first so the file holds this moment
		const act = this.active;
		if ( ! this.readOnly && act && act.slot === slot && act.mode === this.mode && this.app.saveNow ) this.app.saveNow();
		const text = this.vault.exportText( this._key( slot ), { mode: this.mode, slot } );
		if ( ! text ) return this._note( 'Nothing to export in that slot.', true );
		const name = exportName( this.mode, slot );
		const ok = this._download( text, name );
		this._note( ok ? `Exported ${ name }` : 'The browser refused the download.', ! ok );

	}

	exportServer() {

		const p = this._serverProfile();
		if ( ! p ) return;
		const text = JSON.stringify( wrapExport( p.save, { mode: 'multiplayer', captain: p.captain } ), null, '\t' );
		const name = exportName( 'multiplayer', null );
		this._note( this._download( text, name ) ? `Exported ${ name }` : 'The browser refused the download.' );

	}

	async _fileChosen() {

		const f = this.fileInput.files && this.fileInput.files[ 0 ];
		const slot = this._importSlot;
		if ( ! f || slot === null ) return;
		if ( f.size > 2 * 1024 * 1024 ) return this._note( 'That file is too large to be a save.', true );
		let text = '';
		try { text = await f.text(); } catch ( e ) { return this._note( 'Could not read that file.', true ); }
		this.importText( slot, text );

	}

	// -> the vault's report; the note says what happened
	importText( slot, text ) {

		if ( this.readOnly ) return this._refuse();
		const r = this.vault.importText( this._key( slot ), text );
		if ( ! r.ok ) {

			const why = ( r.errors || [] ).slice( 0, 4 ).map( ( e ) => `${ e.path || 'file' }: ${ e.msg }` ).join( '\n' );
			this._note( `Import refused:\n${ why }`, true );

		} else {

			const from = r.source === 'server' ? 'a server profile' : r.source === 'export' ? 'an exported save' : 'a save';
			const reloaded = this._changed( slot );
			this._note( `Imported ${ from } into slot ${ slot + 1 }${ r.applied && r.applied.length ? ` (updated: migrations ${ r.applied.join( ', ' ) })` : '' }${ reloaded ? ' and loaded it' : '' }.` );

		}

		this.refresh();
		return r;

	}

	duplicate( from, to ) {

		if ( this.readOnly ) return this._refuse();
		const r = this.vault.duplicate( this._key( from ), this._key( to ) );
		if ( r.ok ) this._changed( to );
		this._note( r.ok ? `Slot ${ from + 1 } copied to slot ${ to + 1 }.` : `Copy failed: ${ ( r.errors[ 0 ] || {} ).msg || 'unknown' }`, ! r.ok );
		return r;

	}

	deleteSlot( slot ) {

		if ( this.readOnly ) return this._refuse().ok;
		const act = this.active;
		if ( act && act.slot === slot && act.mode === this.mode ) {

			this._note( 'That slot is being played: load another one first.', true );
			return false;

		}

		this.vault.remove( this._key( slot ) );
		this._note( `Slot ${ slot + 1 } deleted (a backup is kept).` );
		return true;

	}

	restore( slot, i ) {

		if ( this.readOnly ) return this._refuse();
		const r = this.vault.restore( this._key( slot ), i );
		const reloaded = r.ok && this._changed( slot );
		this._note( r.ok ? `Backup #${ i } restored into slot ${ slot + 1 }${ reloaded ? ' and loaded' : '' }.` : `Restore failed: ${ ( r.errors[ 0 ] || {} ).msg || 'unknown' }`, ! r.ok );
		return r;

	}

	copyServerTo( slot ) {

		if ( this.readOnly ) return this._refuse();
		const p = this._serverProfile();
		if ( ! p ) return null;
		return this.importText( slot, p.json );

	}

	dispose() {

		if ( this.el ) this.el.remove();
		this.el = null;
		this.isOpen = false;

	}

}

// as a feature module: features.get( 'saves' ).open()
export function install( app ) {

	return new SaveManager( { app } );

}

export default { install };
