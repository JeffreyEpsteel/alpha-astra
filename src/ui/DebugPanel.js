import { FISH, FISH_IDS } from '../game/FishTable.js';
import { WORLD } from '../world/WorldLayout.js';
import { errorLog } from '../core/ErrorLog.js';

// Sandbox debug panel (a feature module): the cheat tools of the Unreal game's cheat manager in one small window.
// ` (Backquote) opens it in the sandbox; in the campaign and multiplayer the key only says it is a sandbox tool.
//
//   features.add( 'debug', DebugPanelModule );   // import * as DebugPanelModule from '../ui/DebugPanel.js'
//   const d = features.get( 'debug' );
//   d.open() / close() / toggle() / isOpen / wantsMouse()
//   d.setTime( hours ) / addXp( n ) / addMoney( n ) / giveFish( species, kg? ) / teleport( portId ) / saveNow()
//
// Time: the island clock (app.settings.timeOfDay) and quick picks; XP: state.addXp; money: state.earn; a fish of any
// species into the hold (state.addFish, not counted as a catch event); a jump to any port in WORLD.ports (read when the
// panel opens: new islands appear by themselves); save now (app.saveNow); the error log viewer; a rumble and a kick test.
// Every action refuses outside the sandbox (the panel can't be opened there, the methods check again).

export const KEY = 'Backquote';
const TIME_PICKS = [ [ 'Dawn', 6 ], [ 'Noon', 12 ], [ 'Dusk', 18.6 ], [ 'Night', 23 ] ];

const CSS = /* css */`
.dbg { position: absolute; left: var(--tw-4, 16px); top: 50%; transform: translateY(-50%); z-index: 28; width: min(330px, calc(100% - 32px));
	max-height: calc(100% - 32px); overflow: auto; padding: 12px 14px; border-radius: 12px; display: flex; flex-direction: column; gap: 10px;
	font: 500 13px var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #eef6f8); background: rgba(6, 16, 24, 0.9); }
.dbg[hidden] { display: none; }
.dbg-head { display: flex; align-items: center; }
.dbg-title { flex: 1; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-size: 12px; }
.dbg-sec { display: flex; flex-direction: column; gap: 6px; }
.dbg-label { color: var(--tw-ink-3, #9fb3bd); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.dbg-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dbg button, .dbg select { font: inherit; font-size: 12px; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 8px; padding: 4px 9px; cursor: pointer; }
.dbg select option { color: #000; }
.dbg button:hover { background: rgba(255, 255, 255, 0.16); }
.dbg input[type=range] { flex: 1; }
.dbg-val { min-width: 3.5em; text-align: right; font-family: var(--tw-mono, ui-monospace, monospace); }
`;

const esc = ( s ) => String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ c ] ) );
const hhmm = ( h ) => {

	const m = Math.round( ( ( ( h % 24 ) + 24 ) % 24 ) * 60 );
	return `${ String( Math.floor( m / 60 ) % 24 ).padStart( 2, '0' ) }:${ String( m % 60 ).padStart( 2, '0' ) }`;

};

export class DebugPanel {

	constructor( app, features ) {

		this.app = app || {};
		this.features = features || null;
		this.isOpen = false;
		this.el = null;
		this.keyOk = features && features.claimKey ? features.claimKey( KEY, 'debug' ) : true;
		this._onKey = ( e ) => this._key( e );
		if ( typeof window !== 'undefined' && window.addEventListener ) window.addEventListener( 'keydown', this._onKey, { capture: true } );

	}

	get sandbox() {

		return !! ( this.features ? this.features.sandbox : this.app.mode === 'sandbox' );

	}

	get state() {

		return this.app.game ? this.app.game.state : null;

	}

	wantsMouse() {

		return this.isOpen;

	}

	_toast( text, ms = 1800 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_key( e ) {

		if ( ! this.keyOk || e.code !== KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey ) return;
		const t = e.target;
		if ( t && ( t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ) ) return;
		if ( this.app.menuOpen ) return;
		e.preventDefault();
		if ( ! this.sandbox ) {

			if ( this.isOpen ) this.close();
			this._toast( 'Debug tools: sandbox only' );
			return;

		}

		this.toggle();

	}

	open() {

		if ( ! this.sandbox || typeof document === 'undefined' ) return false;
		if ( ! this.el ) this._build();
		this._fill();
		this.el.hidden = false;
		this.isOpen = true;
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

	// ---- the actions (sandbox only)

	setTime( h ) {

		if ( ! this.sandbox || ! Number.isFinite( h ) || ! this.app.settings ) return false;
		this.app.settings.timeOfDay = ( ( h % 24 ) + 24 ) % 24;
		return true;

	}

	addXp( n ) {

		const st = this.state;
		if ( ! this.sandbox || ! st || ! st.addXp ) return null;
		return st.addXp( n );

	}

	addMoney( n ) {

		const st = this.state;
		if ( ! this.sandbox || ! st || ! st.earn ) return null;
		return st.earn( n );

	}

	// a fish of `species` (kg: random in its range, skewed small) into the hold; null when it did not fit
	giveFish( species, kg = null ) {

		const st = this.state, f = FISH[ species ];
		if ( ! this.sandbox || ! st || ! f ) return null;
		const w = Number.isFinite( kg ) ? kg : f.kg[ 0 ] + ( f.kg[ 1 ] - f.kg[ 0 ] ) * Math.pow( Math.random(), 2 );
		const tod = this.app.settings ? this.app.settings.timeOfDay : 12;
		return st.addFish( species, w, tod, { habitat: 'bay', aboard: false } );

	}

	// the player on foot at a port's stand (WORLD.ports is read now)
	teleport( portId ) {

		if ( ! this.sandbox ) return false;
		const port = ( WORLD.ports || [] ).find( ( p ) => p && p.id === portId );
		const app = this.app, p = app.player;
		if ( ! port || ! p || ! p.position ) return false;
		const at = port.stand || ( port.dock && port.dock.start ) || port.center;
		if ( ! at ) return false;
		try {

			if ( p.mode === 'boat' && p.leaveHelm ) p.leaveHelm();
			if ( ( p.mode === 'deck' || p.mode === 'seat' ) && p.exitBoat ) p.exitBoat( null, 1 );
			if ( app.freeCam && app.setFreeCam ) app.setFreeCam( false );
			const td = app.terrainData, col = app.colliders;
			const ground = Math.max( td && td.heightAt ? td.heightAt( at.x, at.z ) : 0, col && col.groundHeightAt ? col.groundHeightAt( at.x, at.z, 50 ) : - Infinity );
			const yaw = Number.isFinite( at.yaw ) ? at.yaw : 0;
			if ( typeof app._placePlayer === 'function' ) app._placePlayer( at.x, ground + 0.1, at.z, yaw );
			else {

				p.mode = 'walk';
				p.position.set( at.x, ground + 0.1, at.z );
				if ( p.velocity ) p.velocity.set( 0, 0, 0 );

			}

			const st = this.state;
			if ( st && st.discover ) st.discover( port.id );

		} catch ( e ) {

			console.warn( 'debug teleport failed', e );
			return false;

		}

		return true;

	}

	saveNow() {

		const app = this.app;
		const ok = app.saveNow ? app.saveNow() : !! ( this.state && this.state.save && this.state.save() );
		this._toast( ok ? 'Saved' : 'Save failed' );
		return ok;

	}

	// ---- the panel

	_build() {

		if ( ! document.getElementById( 'dbg-style' ) ) {

			const st = document.createElement( 'style' );
			st.id = 'dbg-style';
			st.textContent = CSS;
			document.head.append( st );

		}

		const el = this.el = document.createElement( 'div' );
		el.className = 'dbg tw-interactive';
		el.setAttribute( 'role', 'dialog' );
		el.setAttribute( 'aria-label', 'Debug tools' );
		el.hidden = true;
		for ( const t of [ 'pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'touchstart' ] ) el.addEventListener( t, ( e ) => e.stopPropagation(), { passive: true } );
		el.addEventListener( 'click', ( e ) => this._click( e ) );
		el.addEventListener( 'input', ( e ) => {

			if ( e.target && e.target.dataset.a === 'time' ) {

				this.setTime( Number( e.target.value ) );
				this._syncTime();

			}

		} );
		const ui = this.app.ui && this.app.ui.ui;
		( ( ui && ( ui.hud || ui.root ) ) || document.body ).append( el );

	}

	_fill() {

		const ports = ( WORLD.ports || [] ).filter( ( p ) => p && p.id );
		const tod = this.app.settings ? this.app.settings.timeOfDay : 12;
		const errs = errorLog();
		this.el.innerHTML = `<div class="dbg-head"><span class="dbg-title">Debug · sandbox</span><button type="button" data-a="close" aria-label="Close">✕</button></div>
			<div class="dbg-sec"><span class="dbg-label">Time</span>
				<div class="dbg-row"><input type="range" min="0" max="24" step="0.05" value="${ tod }" data-a="time" aria-label="Time of day"><span class="dbg-val">${ hhmm( tod ) }</span></div>
				<div class="dbg-row">${ TIME_PICKS.map( ( [ n, h ] ) => `<button type="button" data-a="pick" data-h="${ h }">${ n }</button>` ).join( '' ) }</div></div>
			<div class="dbg-sec"><span class="dbg-label">Progress</span>
				<div class="dbg-row"><button type="button" data-a="xp" data-n="100">+100 XP</button><button type="button" data-a="xp" data-n="1000">+1000 XP</button>
				<button type="button" data-a="money" data-n="1000">+$1,000</button><button type="button" data-a="money" data-n="10000">+$10,000</button></div></div>
			<div class="dbg-sec"><span class="dbg-label">Give fish</span>
				<div class="dbg-row"><select data-a="species" aria-label="Species">${ FISH_IDS.map( ( id ) => `<option value="${ id }">${ esc( FISH[ id ].name ) }</option>` ).join( '' ) }</select>
				<button type="button" data-a="fish">Give</button></div></div>
			<div class="dbg-sec"><span class="dbg-label">Teleport</span>
				<div class="dbg-row">${ ports.map( ( p ) => `<button type="button" data-a="tp" data-port="${ esc( p.id ) }">${ esc( p.name || p.id ) }</button>` ).join( '' ) }</div></div>
			<div class="dbg-sec"><span class="dbg-label">Tools</span>
				<div class="dbg-row"><button type="button" data-a="save">Save now</button>
				<button type="button" data-a="errors">Error log${ errs && errs.errorCount ? ` (${ errs.errorCount })` : '' }</button>
				<button type="button" data-a="rumble">Rumble test</button><button type="button" data-a="kick">Kick test</button></div></div>`;

	}

	_syncTime() {

		const v = this.el && this.el.querySelector( '.dbg-val' );
		const r = this.el && this.el.querySelector( 'input[data-a=time]' );
		const tod = this.app.settings ? this.app.settings.timeOfDay : 12;
		if ( v ) v.textContent = hhmm( tod );
		if ( r && document.activeElement !== r ) r.value = tod;

	}

	_click( e ) {

		const b = e.target.closest && e.target.closest( 'button[data-a]' );
		if ( ! b ) return;
		const a = b.dataset.a;
		switch ( a ) {

			case 'close': this.close(); break;
			case 'pick': this.setTime( Number( b.dataset.h ) ); this._syncTime(); break;
			case 'xp': {

				const r = this.addXp( Number( b.dataset.n ) );
				if ( r ) this._toast( `+${ r.gained } XP · level ${ r.level }` );
				break;

			}

			case 'money': if ( this.addMoney( Number( b.dataset.n ) ) !== null ) this._toast( `+$${ Number( b.dataset.n ).toLocaleString( 'en-US' ) }` ); break;
			case 'fish': {

				const sel = this.el.querySelector( 'select[data-a=species]' );
				const f = this.giveFish( sel ? sel.value : FISH_IDS[ 0 ] );
				this._toast( f ? `${ FISH[ f.species ].name } · ${ f.kg } kg in the hold` : 'The hold is full' );
				break;

			}

			case 'tp': if ( this.teleport( b.dataset.port ) ) { this._toast( 'Teleported' ); this.close(); } break;
			case 'save': this.saveNow(); break;
			case 'errors': { const l = errorLog(); if ( l ) l.open(); else this._toast( 'The error log is not installed' ); break; }
			case 'rumble': { const gp = this.app.gamepad; this._toast( gp && gp.rumble && gp.rumble( 'broadside' ) ? 'Rumble sent' : 'No gamepad with rumble' ); break; }
			case 'kick': if ( this.app.cameraFeel ) this.app.cameraFeel.kick( 'broadside' ); break;

		}

	}

	update() {

		if ( this.isOpen && ! this.sandbox ) this.close(); // a mode switch while it was open
		else if ( this.isOpen ) this._syncTime();

	}

	reset() {

		this.close();

	}

	dispose() {

		if ( typeof window !== 'undefined' && window.removeEventListener ) window.removeEventListener( 'keydown', this._onKey, { capture: true } );
		if ( this.el ) this.el.remove();
		this.el = null;

	}

}

export function install( app, features ) {

	return new DebugPanel( app, features );

}

export default { install };
