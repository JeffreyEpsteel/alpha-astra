// The death cut: the screen goes black, a cause line and where you wake, then it fades back. DOM only (nothing in
// node); the death feature drives the opacity every frame. Parented to the UI root (z-index 900 inside it): above every
// panel, the welcome guide and the HUD layer (which photo mode hides).
//
//   const o = new DeathOverlay( parentEl );   o.show( title, sub );   o.set( alpha 0..1 );   o.hide();   o.dispose()

const CSS = /* css */`
.dt-cut { position: absolute; inset: 0; z-index: 900; background: #000; opacity: 0; pointer-events: none; display: none;
	align-items: center; justify-content: center; flex-direction: column; gap: calc(10 * var(--tw-u, 1px)); text-align: center; }
.dt-cut.is-on { display: flex; }
.dt-cut h2 { margin: 0; font: 600 calc(30 * var(--tw-u, 1px)) var(--tw-font, sans-serif); color: #f3ead8; letter-spacing: 0.02em; }
.dt-cut p { margin: 0; font: 400 calc(14 * var(--tw-u, 1px)) var(--tw-font, sans-serif); color: rgba(243, 234, 216, 0.72); max-width: 34em; }
`;

let cssDone = false;

export class DeathOverlay {

	constructor( parent ) {

		this.el = null;
		this.alpha = 0;
		if ( ! parent || typeof document === 'undefined' ) return;
		if ( ! cssDone && document.head ) {

			cssDone = true;
			const st = document.createElement( 'style' );
			st.textContent = CSS;
			document.head.append( st );

		}

		this.el = document.createElement( 'div' );
		this.el.className = 'dt-cut';
		this.el.setAttribute( 'role', 'status' );
		this.el.setAttribute( 'aria-live', 'assertive' );
		this.title = document.createElement( 'h2' );
		this.sub = document.createElement( 'p' );
		this.el.append( this.title, this.sub );
		parent.append( this.el );

	}

	show( title, sub = '' ) {

		if ( ! this.el ) return;
		this.title.textContent = title;
		this.sub.textContent = sub;
		this.el.classList.add( 'is-on' );
		this.set( 0 );

	}

	set( a ) {

		a = Math.max( 0, Math.min( 1, a ) );
		if ( ! this.el || Math.abs( a - this.alpha ) < 0.004 ) return;
		this.alpha = a;
		this.el.style.opacity = a.toFixed( 3 );

	}

	hide() {

		if ( ! this.el ) return;
		this.set( 0 );
		this.el.classList.remove( 'is-on' );

	}

	dispose() {

		if ( this.el ) this.el.remove();
		this.el = null;

	}

}
