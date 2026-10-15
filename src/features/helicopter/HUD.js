// Compact native DOM flight strip, independent of the shared fishing/boat HUD.
export class HelicopterHUD {
	constructor() {
		this.root = null;
		if ( typeof document === 'undefined' || ! document.body ) return;
		const root = this.root = document.createElement( 'div' ); root.className = 'helicopter-flight-hud';
		root.setAttribute( 'role', 'status' ); root.setAttribute( 'aria-label', 'Rescue helicopter instruments' );
		root.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 76px);transform:translateX(-50%);max-width:min(470px,86vw);padding:8px 12px;border:1px solid #a3c7b980;border-radius:8px;background:#10272be8;color:#f5ebcd;font:12px/1.45 system-ui,sans-serif;white-space:pre-line;text-align:center;pointer-events:none;z-index:85;box-shadow:0 3px 15px #0005';
		root.hidden = true; document.body.append( root );
	}
	update( h ) {
		if ( ! this.root ) return;
		this.root.hidden = ! h.piloted || h.blocked();
		if ( this.root.hidden ) return;
		const v = h.view(), rotor = v.rpm < 0.8 ? 'ROTOR STARTING' : v.grounded ? 'LANDED' : 'FLIGHT';
		const touch = h.app.input?.touchMode;
		const text = `RESCUE ${ rotor }  ·  ALT ${ v.altitude } m  ·  AGL ${ v.agl } m\n${ v.speed } km/h  ·  V/S ${ v.verticalSpeed.toFixed( 1 ) } m/s  ·  ROTOR ${ Math.round( v.rpm * 100 ) }%  ·  HULL ${ v.hp }%\n` + ( touch ? 'Stick: forward/back + turn · Rise / Descend: altitude\nHover / brake: stop · Slide: sideways · View: cockpit · E exit when landed' : 'W/S forward/back · A/D turn · ,/. strafe · Shift rise · C descend\nSpace hover/brake · V cockpit · E exit when landed' );
		if ( text !== this._last ) { this.root.textContent = text; this._last = text; }
	}
	dispose() { this.root?.remove(); this.root = null; }
}
