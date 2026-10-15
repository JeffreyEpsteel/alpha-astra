import { icon } from '../../ui/icons.js';

// The weather chip: an icon and the weather's name under the mode chip at the top left of the HUD, a wind
// reading, and a pulsing "Storm warning" for the last minute before a storm. Own DOM, styles injected once
// (ids and classes prefixed wx-, the --tw-* tokens of ui/ui.css). Attaches to the HUD column that holds the
// mode chip (.tw-tl) the first time it finds it; without a DOM (tests, ?noUI) it does nothing.
//
//   const hud = new WeatherHUD( app );
//   hud.update( { kind, wind, warning: seconds | null, manual: bool } )     // cheap: touches the DOM on change only

const CSS = /* css */`
.wx-chip { display: inline-flex; align-items: center; gap: calc(6 * var(--tw-u)); height: calc(26 * var(--tw-u)); margin: 0 0 0 calc(2 * var(--tw-u));
	padding: 0 calc(11 * var(--tw-u)) 0 calc(8 * var(--tw-u)); border: 1px solid var(--tw-line); border-radius: 999px;
	background: rgba(12, 18, 26, 0.55); -webkit-backdrop-filter: blur(12px) saturate(1.5); backdrop-filter: blur(12px) saturate(1.5);
	font: 500 var(--tw-fs-sm) var(--tw-font); white-space: nowrap; color: var(--tw-ink); pointer-events: none;
	transition: opacity 900ms var(--tw-ease), border-color 300ms var(--tw-ease), color 300ms var(--tw-ease); }
.tw-root.is-idle .wx-chip { opacity: 0.5; }
.wx-ico { display: inline-flex; color: var(--tw-aqua); transition: color 300ms var(--tw-ease); }
.wx-ico .tw-ico { width: calc(14 * var(--tw-u)); height: calc(14 * var(--tw-u)); }
.wx-name { font-weight: 500; }
.wx-sub { font: 500 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-3); }
.wx-chip.is-warn { border-color: rgba(255, 122, 133, 0.65); color: var(--tw-coral); animation: wx-pulse 1.3s var(--tw-ease-io) infinite; }
.wx-chip.is-warn .wx-ico, .wx-chip.is-warn .wx-sub { color: var(--tw-coral); }
.wx-chip.is-bump { animation: wx-bump 900ms var(--tw-ease); }
@keyframes wx-bump { 0% { border-color: rgba(var(--tw-aqua-rgb), 0.8); box-shadow: 0 0 0 0 rgba(var(--tw-aqua-rgb), 0.45); } 100% { border-color: var(--tw-line); box-shadow: 0 0 0 10px rgba(var(--tw-aqua-rgb), 0); } }
@keyframes wx-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 122, 133, 0.5); } 50% { box-shadow: 0 0 0 7px rgba(255, 122, 133, 0); } }
@media (prefers-reduced-motion: reduce) { .wx-chip.is-warn, .wx-chip.is-bump { animation: none; } }
`;

export const WEATHER_UI = {
	clear: { name: 'Clear', icon: 'sun' },
	breezy: { name: 'Breezy', icon: 'wind' },
	overcast: { name: 'Overcast', icon: 'cloud' },
	rain: { name: 'Rain', icon: 'droplet' },
	storm: { name: 'Storm', icon: 'storm' },
	fog: { name: 'Fog', icon: 'fog' },
};

export class WeatherHUD {

	constructor( app ) {

		this.app = app;
		this.el = null;
		this._key = '';
		this._kind = null;
		this._retry = 0;
		this.attached = false;

	}

	// the column of the top-left HUD, or null while the UI is not built yet
	_host() {

		if ( typeof document === 'undefined' ) return null;
		const ui = this.app && this.app.ui && this.app.ui.ui;
		const mode = ui && ui.modeEl;
		if ( mode && mode.closest ) {

			const col = mode.closest( '.tw-tl' );
			if ( col ) return col;

		}

		return document.querySelector ? document.querySelector( '.tw-tl' ) : null;

	}

	_build() {

		if ( ! document.getElementById( 'wx-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'wx-style';
			style.textContent = CSS;
			document.head.append( style );

		}

		const el = document.createElement( 'div' );
		el.className = 'wx-chip';
		el.setAttribute( 'role', 'status' );
		el.setAttribute( 'aria-live', 'polite' );
		el.innerHTML = '<span class="wx-ico"></span><span class="wx-name"></span><span class="wx-sub"></span>';
		this.el = el;
		this.icoEl = el.querySelector( '.wx-ico' );
		this.nameEl = el.querySelector( '.wx-name' );
		this.subEl = el.querySelector( '.wx-sub' );

	}

	update( s, dt = 0 ) {

		if ( typeof document === 'undefined' ) return;
		if ( ! this.attached ) {

			this._retry -= dt;
			if ( this._retry > 0 ) return;
			this._retry = 1;
			const host = this._host();
			if ( ! host ) return;
			if ( ! this.el ) this._build();
			host.append( this.el );
			this.attached = true;

		}

		const warn = s.warning !== null && s.warning !== undefined && s.kind !== 'storm';
		const info = WEATHER_UI[ s.kind ] || WEATHER_UI.clear;
		const name = warn ? 'Storm warning' : info.name;
		const sub = warn ? `${ Math.max( 1, Math.ceil( s.warning ) ) } s` : `${ Math.round( s.wind ) } m/s${ s.manual ? ' · set' : '' }`;
		const key = `${ warn ? 'w' : s.kind }|${ name }|${ sub }`;
		if ( key === this._key ) return;
		this._key = key;
		this.nameEl.textContent = name;
		this.subEl.textContent = sub;
		const ico = warn ? 'storm' : info.icon;
		if ( this._ico !== ico ) {

			this._ico = ico;
			this.icoEl.innerHTML = icon( ico );

		}

		this.el.classList.toggle( 'is-warn', warn );
		if ( this._kind !== null && this._kind !== s.kind && ! warn ) {

			this.el.classList.remove( 'is-bump' );
			void this.el.offsetWidth;
			this.el.classList.add( 'is-bump' );

		}

		this._kind = s.kind;

	}

	dispose() {

		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;
		this.attached = false;

	}

}
