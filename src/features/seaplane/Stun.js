// The black-out of a pilot thrown clear of a wreck (wave 10): the screen goes black for CRASH.stun seconds and fades back
// over FADE. The death feature has no fade of its own to borrow (its cut is the whole respawn), so this is a plain black
// layer in the HUD host, built on first use; headless (no DOM) it only keeps time, so the tests can read `active`.
//
//   const s = new Stun( app );  s.start( seconds );  s.update( dt );  s.active;  s.level (0..1);  s.dispose()

export const FADE = 0.6; // s back from black

export class Stun {

	constructor( app ) {

		this.app = app || {};
		this.t = 0;
		this.hold = 0;
		this.active = false;
		this.level = 0;
		this.el = null;

	}

	_ensure() {

		if ( this.el ) return this.el;
		if ( typeof document === 'undefined' ) return null;
		const ui = this.app.ui && this.app.ui.ui;
		const host = ui ? ui.hud || ui.root : document.body;
		if ( ! host ) return null;
		const el = document.createElement( 'div' );
		el.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40;transition:none';
		host.append( el );
		this.el = el;
		return el;

	}

	start( hold ) {

		this.t = 0;
		this.hold = Math.max( 0, hold || 0 );
		this.active = true;
		this.level = 1;
		const el = this._ensure();
		if ( el ) el.style.opacity = '1';

	}

	update( dt ) {

		if ( ! this.active ) return;
		this.t += dt;
		this.level = this.t < this.hold ? 1 : Math.max( 0, 1 - ( this.t - this.hold ) / FADE );
		if ( this.el ) this.el.style.opacity = String( this.level );
		if ( this.level <= 0 ) this.active = false;

	}

	dispose() {

		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;
		this.active = false;

	}

}
