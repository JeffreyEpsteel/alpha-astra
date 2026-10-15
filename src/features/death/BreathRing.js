// The breath ring (wave 22B): a thin ring a little under the centre of the screen while you are under water or your lungs
// fill again (contextual: never on screen otherwise), with the darkening vignette of the last seconds of air. DOM only
// (nothing in node); the death feature hands it Breath.ring() every frame. RING / TONES are the geometry and colours (the
// headless captures draw the same ring over a game frame: tools/capsize/capture.mjs).
//
//   const r = new BreathRing( parentEl );   r.set( breath.ring(), time );   r.dispose()

export const RING = { size: 46, stroke: 5, y: 0.6 }; // px (x the UI scale), centre at y of the screen height
export const TONES = { ok: '#d8f1ff', warn: '#ffc35a', out: '#ff5a4a', track: 'rgba(8, 20, 30, 0.45)' };

const CSS = /* css */`
.br-ring { position: absolute; left: 50%; top: ${ RING.y * 100 }%; width: calc(${ RING.size } * var(--tw-u, 1px)); height: calc(${ RING.size } * var(--tw-u, 1px));
	transform: translate(-50%, -50%); pointer-events: none; z-index: 40; opacity: 0; transition: opacity 0.25s; }
.br-ring.is-on { opacity: 1; }
.br-ring svg { width: 100%; height: 100%; display: block; overflow: visible; }
.br-ring .br-track { fill: none; stroke: ${ TONES.track }; stroke-width: ${ RING.stroke }; }
.br-ring .br-arc { fill: none; stroke-width: ${ RING.stroke }; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
.br-vig { position: absolute; inset: 0; pointer-events: none; z-index: 39; opacity: 0;
	background: radial-gradient(ellipse at center, rgba(0, 8, 16, 0) 38%, rgba(0, 8, 16, 0.75) 78%, rgba(0, 4, 8, 0.97) 100%); }
`;

let cssDone = false;
const R = ( RING.size - RING.stroke ) / 2, C = 2 * Math.PI * R;

export class BreathRing {

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

		this.vig = document.createElement( 'div' );
		this.vig.className = 'br-vig';
		this.el = document.createElement( 'div' );
		this.el.className = 'br-ring';
		if ( this.el.setAttribute ) this.el.setAttribute( 'aria-hidden', 'true' );
		const h = RING.size / 2;
		this.el.innerHTML = `<svg viewBox="0 0 ${ RING.size } ${ RING.size }"><circle class="br-track" cx="${ h }" cy="${ h }" r="${ R }"/><circle class="br-arc" cx="${ h }" cy="${ h }" r="${ R }" stroke-dasharray="${ C.toFixed( 2 ) }" stroke-dashoffset="0"/></svg>`;
		this.arc = typeof this.el.querySelector === 'function' ? this.el.querySelector( '.br-arc' ) : null; // (a minimal test DOM has none)
		if ( parent.append ) parent.append( this.vig, this.el );

	}

	// m: Breath.ring(); time (s) for the pulse
	set( m, time = 0 ) {

		if ( ! this.el || ! m ) return;
		const pulse = m.pulse > 0 ? 0.55 + 0.45 * Math.abs( Math.sin( time * Math.PI * ( m.pulse > 0.5 ? 3 : 1.6 ) ) ) : 1;
		const key = `${ m.show ? 1 : 0 }|${ m.frac.toFixed( 3 ) }|${ m.tone }|${ m.vignette.toFixed( 2 ) }|${ pulse.toFixed( 2 ) }`;
		if ( key === this._key ) return;
		this._key = key;
		if ( this.el.classList ) this.el.classList.toggle( 'is-on', !! m.show );
		if ( this.arc && this.arc.setAttribute && this.arc.style ) {

			this.arc.setAttribute( 'stroke-dashoffset', ( C * ( 1 - Math.max( 0, Math.min( 1, m.frac ) ) ) ).toFixed( 2 ) );
			this.arc.style.stroke = TONES[ m.tone ] || TONES.ok;
			this.arc.style.opacity = pulse.toFixed( 2 );

		}

		if ( this.vig.style ) this.vig.style.opacity = ( m.vignette * ( m.tone === 'out' ? 0.85 + 0.15 * pulse : 1 ) ).toFixed( 3 );

	}

	hide() {

		if ( this.el ) this.set( { show: false, frac: 1, tone: 'ok', vignette: 0, pulse: 0 } );

	}

	dispose() {

		if ( this.el && this.el.remove ) this.el.remove();
		if ( this.vig && this.vig.remove ) this.vig.remove();
		this.el = null;
		this.vig = null;

	}

}
