// The righting meter (wave 22B): shown only while you work an upturned hull (contextual), low in the middle of the screen.
// A balance bar: the sweet spot (where the swell helps) swings along it, the marker is your lean; under it her heel (how far
// she has come over) and a thin stamina line; the bar reddens as your grip strains. DOM only (nothing in node); METER and
// COLORS are the geometry the headless captures draw the same way (tools/capsize/capture.mjs).
//
//   const m = new RightingMeter( parentEl );   m.set( righting.model() | null );   m.dispose()

export const METER = { w: 300, h: 16, y: 0.76, gap: 8, heelH: 8, staminaH: 3 }; // px (x the UI scale); y: the bar's top / screen height
export const COLORS = { track: 'rgba(8, 20, 30, 0.6)', spot: 'rgba(120, 220, 160, 0.55)', spotOn: 'rgba(140, 255, 180, 0.85)',
	marker: '#f3ead8', strain: '#ff5a4a', heel: '#6fc3ff', stamina: '#ffd27a', frame: 'rgba(243, 234, 216, 0.35)' };

const CSS = /* css */`
.cz-meter { position: absolute; left: 50%; top: ${ METER.y * 100 }%; width: calc(${ METER.w } * var(--tw-u, 1px)); transform: translateX(-50%);
	pointer-events: none; z-index: 40; display: none; font: 600 calc(12 * var(--tw-u, 1px)) var(--tw-font, sans-serif); color: #f3ead8;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.cz-meter.is-on { display: block; }
.cz-bar { position: relative; height: calc(${ METER.h } * var(--tw-u, 1px)); border-radius: calc(4 * var(--tw-u, 1px)); background: ${ COLORS.track };
	box-shadow: inset 0 0 0 1px ${ COLORS.frame }; overflow: hidden; }
.cz-spot { position: absolute; top: 0; bottom: 0; background: ${ COLORS.spot }; }
.cz-spot.is-in { background: ${ COLORS.spotOn }; }
.cz-strain { position: absolute; inset: 0; background: ${ COLORS.strain }; opacity: 0; }
.cz-mark { position: absolute; top: -2px; bottom: -2px; width: calc(4 * var(--tw-u, 1px)); margin-left: calc(-2 * var(--tw-u, 1px)); background: ${ COLORS.marker };
	border-radius: 2px; box-shadow: 0 0 4px rgba(0, 0, 0, 0.6); }
.cz-heel { margin-top: calc(${ METER.gap } * var(--tw-u, 1px)); height: calc(${ METER.heelH } * var(--tw-u, 1px)); border-radius: calc(4 * var(--tw-u, 1px));
	background: ${ COLORS.track }; overflow: hidden; }
.cz-heel i, .cz-sta i { display: block; height: 100%; width: 0; background: ${ COLORS.heel }; }
.cz-sta { margin-top: calc(3 * var(--tw-u, 1px)); height: calc(${ METER.staminaH } * var(--tw-u, 1px)); background: ${ COLORS.track }; }
.cz-sta i { background: ${ COLORS.stamina }; }
.cz-label { display: flex; justify-content: space-between; margin-bottom: calc(4 * var(--tw-u, 1px)); opacity: 0.9; }
`;

let cssDone = false;
const pct = ( v ) => ( Math.max( 0, Math.min( 1, v ) ) * 100 ).toFixed( 1 ) + '%';

export class RightingMeter {

	constructor( parent ) {

		this.el = null;
		this._key = '';
		if ( ! parent || typeof document === 'undefined' ) return;
		if ( ! cssDone && document.head ) {

			cssDone = true;
			const st = document.createElement( 'style' );
			st.textContent = CSS;
			document.head.append( st );

		}

		this.el = document.createElement( 'div' );
		this.el.className = 'cz-meter';
		if ( this.el.setAttribute ) this.el.setAttribute( 'aria-hidden', 'true' );
		this.el.innerHTML = '<div class="cz-label"><span>Lean with the swell</span><span class="cz-help"></span></div>'
			+ '<div class="cz-bar"><div class="cz-spot"></div><div class="cz-strain"></div><div class="cz-mark"></div></div>'
			+ '<div class="cz-heel"><i></i></div><div class="cz-sta"><i></i></div>';
		const q = ( s ) => ( typeof this.el.querySelector === 'function' ? this.el.querySelector( s ) : null ) || { style: {}, classList: { toggle() {} } };
		this.spot = q( '.cz-spot' );
		this.strain = q( '.cz-strain' );
		this.mark = q( '.cz-mark' );
		this.heel = q( '.cz-heel i' );
		this.sta = q( '.cz-sta i' );
		this.help = q( '.cz-help' );
		if ( parent.append ) parent.append( this.el );

	}

	set( m ) {

		if ( ! this.el ) return;
		const key = m ? [ m.centre, m.half, m.marker, m.heel, m.stamina, m.strain ].map( ( v ) => v.toFixed( 3 ) ).join( '|' ) + ( m.inSpot ? 'i' : '' ) + m.helpers : '';
		if ( key === this._key ) return;
		this._key = key;
		if ( this.el.classList ) this.el.classList.toggle( 'is-on', !! m );
		if ( ! m ) return;
		this.spot.style.left = pct( m.centre - m.half );
		this.spot.style.width = pct( 2 * m.half );
		this.spot.classList.toggle( 'is-in', !! m.inSpot );
		this.strain.style.opacity = ( Math.min( 1, m.strain ) * 0.55 ).toFixed( 2 );
		this.mark.style.left = pct( m.marker );
		this.heel.style.width = pct( m.heel );
		this.sta.style.width = pct( m.stamina );
		this.help.textContent = m.helpers > 0 ? `${ m.helpers } helping` : '';

	}

	dispose() {

		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

}
