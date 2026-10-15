// Gamepad support on top of core/Input.js: the first connected pad is polled every frame and
// mapped onto the same key codes and look deltas the keyboard / mouse produce, so the player, boat
// and game code need no changes.
//   left stick  -> W A S D (with a dead zone; the walker's analogue speed is not modelled: past half
//                  deflection it runs)
//   right stick -> look (scaled to mouse counts, times the pad sensitivity)
//   A / cross   -> Space (jump, swim up)     B / circle -> C (dive)      X / square -> E (interact)
//   Y / triangle-> R (rod)                   LB -> V (camera)            RB -> Shift (sprint / boost)
//   LT / RT     -> right / left mouse button (reel an empty line / cast and reel)
//   D-pad up    -> I (cooler)   D-pad down -> K (crew)   Start -> H (settings)   Back -> F1 (controls)
// The remappable buttons (ui/Accessibility.js PAD_ACTIONS) are asked from input.padButton( code, default ).
//
//   const pad = new GamepadInput( input ); pad.update(); // before input is read each frame
//
// Last device and family (controller glyphs, ui/Glyphs.js): pad.device is 'keyboard' or the pad family that was used
// last ('xbox' | 'playstation' | 'gamepad'), switched by a key / mouse event or by a button / stick past the dead zone.
//   pad.onDeviceChange( ( device, prev ) => ... ) -> unsubscribe        padFamily( gamepad.id ) -> family
// Rumble (dual-rumble actuator where the browser has one; nothing happens otherwise):
//   pad.rumble( 'strike' | 'catch' | 'snap' | 'cannon' | 'hit' | 'broadside' | 'boarding' | 'explosion', scale = 1 )
//   pad.rumble( { duration: ms, strong: 0..1, weak: 0..1 } )             pad.stopRumble()
// Settings (the accessibility worker's sliders): setDeadZone( 0..0.6 ), setSensitivity( 0.2..3 ), setRumble( 0..1 )
// (0 turns rumble off), plus the getters deadZone / sensitivity / rumbleStrength.

// rumble presets: ms, strong (low-frequency) motor, weak (high-frequency) motor
export const RUMBLE = {
	strike: { duration: 140, strong: 0.35, weak: 0.7 },
	catch: { duration: 220, strong: 0.5, weak: 0.4 },
	snap: { duration: 120, strong: 0.2, weak: 0.9 },
	cannon: { duration: 260, strong: 0.95, weak: 0.35 },
	hit: { duration: 180, strong: 0.6, weak: 0.5 },
	broadside: { duration: 420, strong: 1, weak: 0.6 },
	boarding: { duration: 300, strong: 0.7, weak: 0.3 },
	explosion: { duration: 500, strong: 1, weak: 0.8 },
};

const LOOK_BASE = 11; // mouse counts per frame at full deflection (at 60 Hz ~ 660 / s)

// the pad family from its id string (Chrome: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", "DualSense Wireless
// Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"; Firefox: "054c-0ce6-...")
export function padFamily( id ) {

	const s = String( id || '' ).toLowerCase();
	if ( /054c|playstation|dualsense|dualshock|ps[345]\b|wireless controller/.test( s ) ) return 'playstation';
	if ( /045e|xbox|xinput|x-box/.test( s ) ) return 'xbox';
	return 'gamepad';

}

// apply a radial-free axis dead zone: 0 inside, rescaled to 0..1 outside
export function applyDeadZone( v, dz ) {

	v = v || 0;
	return Math.abs( v ) < dz ? 0 : ( v - Math.sign( v ) * dz ) / ( 1 - dz );

}

const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

export class GamepadInput {

	constructor( input ) {

		this.input = input;
		this.deadZone = 0.22;
		this.sensitivity = 1;
		this.lookSpeed = LOOK_BASE;
		this.rumbleStrength = 1;
		this.enabled = true;
		this.connected = false;
		this.device = 'keyboard';
		this.family = null; // the connected pad's family
		this._deviceFns = new Set();
		this._held = new Set(); // key codes held down by the pad
		this._lmb = false;
		this._rmb = false;
		this._rumbleUntil = 0;
		this._rumbleLevel = 0;
		if ( typeof window !== 'undefined' && window.addEventListener ) {

			window.addEventListener( 'gamepadconnected', ( e ) => {

				this.connected = true;
				this.family = padFamily( e && e.gamepad && e.gamepad.id );

			} );
			window.addEventListener( 'gamepaddisconnected', () => {

				this.connected = false;
				this._releaseAll();
				this._setDevice( 'keyboard' );

			} );
			// a key or the mouse used: the glyphs go back to the keyboard's
			const kb = ( e ) => { if ( ! e || e.isTrusted !== false ) this._setDevice( 'keyboard' ); };
			window.addEventListener( 'keydown', kb, { passive: true } );
			window.addEventListener( 'mousedown', kb, { passive: true } );
			window.addEventListener( 'wheel', kb, { passive: true } );

		}

	}

	// ---- settings

	setDeadZone( v ) {

		this.deadZone = clamp( Number.isFinite( v ) ? v : 0.22, 0, 0.6 );
		return this.deadZone;

	}

	setSensitivity( v ) {

		this.sensitivity = clamp( Number.isFinite( v ) ? v : 1, 0.2, 3 );
		this.lookSpeed = LOOK_BASE * this.sensitivity;
		return this.sensitivity;

	}

	setRumble( v ) {

		this.rumbleStrength = clamp( Number.isFinite( v ) ? v : 1, 0, 1 );
		if ( this.rumbleStrength === 0 ) this.stopRumble();
		return this.rumbleStrength;

	}

	// ---- last device

	onDeviceChange( fn ) {

		this._deviceFns.add( fn );
		return () => this._deviceFns.delete( fn );

	}

	_setDevice( d ) {

		if ( d === this.device ) return;
		const prev = this.device;
		this.device = d;
		for ( const fn of [ ...this._deviceFns ] ) {

			try { fn( d, prev ); } catch ( e ) { /* a listener failing must not stop input */ }

		}

	}

	_pad() {

		if ( typeof navigator === 'undefined' || ! navigator.getGamepads ) return null;
		const pads = navigator.getGamepads();
		for ( const p of pads ) if ( p && p.connected ) return p;
		return null;

	}

	_releaseAll() {

		for ( const code of this._held ) this.input.keys.delete( code );
		this._held.clear();
		if ( this._lmb ) this.input.mouseDown = false;
		if ( this._rmb ) this.input.rightDown = false;
		this._lmb = this._rmb = false;

	}

	// press / release a key code as the keyboard would (hit() sees the edge)
	_key( code, down ) {

		const inp = this.input;
		if ( down && ! this._held.has( code ) ) {

			if ( ! inp.keys.has( code ) ) inp.pressed.add( code );
			inp.keys.add( code );
			this._held.add( code );

		} else if ( ! down && this._held.has( code ) ) {

			inp.keys.delete( code );
			this._held.delete( code );

		}

	}

	// the button a logical code sits on (the player's remap, else the default)
	_btnOf( code, fallback ) {

		const inp = this.input;
		return inp && typeof inp.padButton === 'function' ? inp.padButton( code, fallback ) : fallback;

	}

	update() {

		if ( ! this.enabled ) return;
		const p = this._pad();
		if ( ! p ) {

			if ( this._held.size || this._lmb || this._rmb ) this._releaseAll();
			return;

		}

		this.connected = true;
		if ( ! this.family ) this.family = padFamily( p.id );
		const dz = this.deadZone;
		const ax = ( i ) => applyDeadZone( p.axes[ i ], dz );
		const btn = ( i ) => !! ( p.buttons[ i ] && ( p.buttons[ i ].pressed || p.buttons[ i ].value > 0.5 ) );
		const lx = ax( 0 ), ly = ax( 1 ), rx = ax( 2 ), ry = ax( 3 );
		// any use of the pad makes it the last device (glyphs)
		if ( lx || ly || rx || ry || p.buttons.some( ( b ) => b && b.pressed ) ) this._setDevice( padFamily( p.id ) );
		// movement
		this._key( 'KeyW', ly < - 0.3 );
		this._key( 'KeyS', ly > 0.3 );
		this._key( 'KeyA', lx < - 0.3 );
		this._key( 'KeyD', lx > 0.3 );
		// look
		this.input.look.x += rx * Math.abs( rx ) * this.lookSpeed;
		this.input.look.y += ry * Math.abs( ry ) * this.lookSpeed;
		// buttons (standard mapping; the remappable ones through the player's table)
		this._key( 'Space', btn( this._btnOf( 'Space', 0 ) ) );
		this._key( 'KeyC', btn( this._btnOf( 'KeyC', 1 ) ) );
		this._key( 'KeyE', btn( this._btnOf( 'KeyE', 2 ) ) );
		this._key( 'KeyR', btn( this._btnOf( 'KeyR', 3 ) ) );
		this._key( 'KeyV', btn( this._btnOf( 'KeyV', 4 ) ) );
		this._key( 'ShiftLeft', btn( this._btnOf( 'ShiftLeft', 5 ) ) || Math.hypot( lx, ly ) > 0.95 );
		this._key( 'F1', btn( 8 ) );
		this._key( 'KeyH', btn( 9 ) );
		this._key( 'KeyI', btn( this._btnOf( 'KeyI', 12 ) ) );
		this._key( 'KeyK', btn( this._btnOf( 'KeyK', 13 ) ) );
		// triggers as the mouse buttons (the game reads edges itself)
		const lt = btn( 6 ), rt = btn( 7 );
		if ( rt !== this._lmb ) {

			this.input.mouseDown = rt;
			this._lmb = rt;

		}

		if ( lt !== this._rmb ) {

			this.input.rightDown = lt;
			this._rmb = lt;

		}

	}

	// ---- rumble

	// -> true when an actuator took it. A weaker effect does not cut a stronger one that is still running.
	rumble( effect, scale = 1 ) {

		const e = typeof effect === 'string' ? RUMBLE[ effect ] : effect;
		if ( ! e || ! ( this.rumbleStrength > 0 ) ) return false;
		const k = clamp( ( Number.isFinite( scale ) ? scale : 1 ) * this.rumbleStrength, 0, 1 );
		const strong = clamp( ( e.strong ?? 0.5 ) * k, 0, 1 ), weak = clamp( ( e.weak ?? 0.5 ) * k, 0, 1 );
		const duration = clamp( e.duration ?? 150, 10, 2000 );
		if ( strong <= 0 && weak <= 0 ) return false;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const level = Math.max( strong, weak );
		if ( now < this._rumbleUntil && level < this._rumbleLevel ) return false;
		const p = this._pad();
		if ( ! p ) return false;
		this._rumbleUntil = now + duration;
		this._rumbleLevel = level;
		try {

			const a = p.vibrationActuator;
			if ( a && typeof a.playEffect === 'function' ) {

				const r = a.playEffect( a.type || 'dual-rumble', { startDelay: 0, duration, strongMagnitude: strong, weakMagnitude: weak } );
				if ( r && typeof r.catch === 'function' ) r.catch( () => {} );
				return true;

			}

			const h = p.hapticActuators && p.hapticActuators[ 0 ];
			if ( h && typeof h.pulse === 'function' ) {

				const r = h.pulse( level, duration );
				if ( r && typeof r.catch === 'function' ) r.catch( () => {} );
				return true;

			}

		} catch ( err ) { /* no haptics on this pad / browser */ }

		return false;

	}

	stopRumble() {

		this._rumbleUntil = 0;
		this._rumbleLevel = 0;
		const p = this._pad();
		try {

			const a = p && p.vibrationActuator;
			if ( a && typeof a.reset === 'function' ) {

				const r = a.reset();
				if ( r && typeof r.catch === 'function' ) r.catch( () => {} );

			}

		} catch ( e ) { /* ignore */ }

	}

}
