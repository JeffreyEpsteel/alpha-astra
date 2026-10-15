// Keyboard / mouse input with pointer lock support.
//
// Callers keep asking for physical-key names ( input.hit( 'KeyE' ) ): those names are the LOGICAL codes. A user
// binding table (ui/Accessibility.js) maps the physical key that was pressed onto the logical codes, so the player
// can rebind Interact to G and every caller still sees 'KeyE'. A logical code with no entry in the table behaves as
// before (the same physical key), so keys other workers add keep working without touching this file.
//
//   input.setBindings( { KeyE: 'KeyG' } )   // logical code -> the physical key that now triggers it
//   input.logical( 'KeyG' )                  // -> [ 'KeyE', 'KeyG' ]  (KeyG is not itself remapped, so it also passes through)
//   input.sensitivity, input.invertY         // look scaling (mouse counts in, consumeLook() out)
//   input.setToggle( [ 'ShiftLeft' ], true ) // those logical codes latch: press to switch on, press to switch off, and
//                                            // they drop when you stop moving (sprint as a toggle)
//   input.reelToggle + input.reelActive()    // left button: while a fish is on, a click starts / stops the reel
//   input.guardToggle                        // right button guard as a toggle (melee reads it; ui/Accessibility.js sets it)
//   input.padButton( code, index )           // gamepad button remap (core/Gamepad.js asks for each button)
//
// Wave 5 (keys that fight the browser):
//   Ctrl / Cmd is not a game key: a key pressed with it is a shortcut, never a move. Ctrl+S is the quick save
//   (input.onShortcut( 'save' )); Ctrl / Cmd + S P D O U F G H are kept from the page while the game has the focus (no
//   text field), and so are plain F1 / F3 (F5 only while the mouse is captured; Shift+F5 still reloads).
//   Ctrl+Shift+I / J / C (devtools) are never touched. Ctrl+W / T / N cannot be stopped by a page except in fullscreen
//   with the Keyboard Lock API: F11 (or input.toggleFullscreen(), the settings button) puts the page in fullscreen and
//   locks the keyboard so those reach the game; leaving fullscreen unlocks it.
//   input.releases counts the moments every button was let go for the game (window blur, pointer lock lost): a latched
//   action (the toggle guard) drops when it changes. The buttons also resync from mousemove's `buttons`, so a mouseup
//   lost to a context menu or to the lock never leaves a button stuck down.
//
// Wave 6 (touch, ui/TouchControls.js): a third source beside the keyboard and the gamepad, with its own held set so
// the three never release each other's keys:
//   input.setTouchKeys( codes )          the logical codes the touch controls hold now (stick, sliders, held buttons);
//                                        a newly held code is a press ( hit() sees it), a dropped one is released
//   input.setTouchButton( 'left' | 'right', down )   cast / reel and guard
//   input.addTouchLook( x, y )           look deltas in mouse counts (core/Touch.js lookDelta; no mouse sensitivity)
//   input.releaseTouch()                 everything the touch controls held is let go
//   input.touchMode                      the touch controls are in use: requestLock() does nothing (no pointer lock
//                                        on a phone), and the mouse events a browser makes up after a tap are ignored
export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set();
		this.look = { x: 0, y: 0 };
		this.wheel = 0;
		this.locked = false;
		this.enabled = true;
		// accessibility (set by ui/Accessibility.js)
		this.sensitivity = 1;
		this.invertY = false;
		this.reelToggle = false;
		this.reelActive = null; // () => bool: a fish is on the line
		this.guardToggle = false;
		this.onShortcut = null; // ( name ) 'save': a browser shortcut the game answers (ui/Accessibility.js wires it)
		this.onFullscreen = null; // ( on ) after a fullscreen change
		this.releases = 0;
		this.keyboardLocked = false;
		this._lmb = false; // the left button as the game sees it (the mouse or the gamepad's trigger)
		this._lmbMouse = false;
		this._lmbExt = false; // set through the mouseDown setter (Gamepad.js)
		this._rmbMouse = false;
		this._rmbExt = false; // set through the rightDown setter (Gamepad.js)
		this._reelLatch = false;
		this._bindings = {}; // logical -> physical
		this._table = new Map(); // physical -> [ logical ]
		this._bound = new Set(); // the physical keys the table maps (the page must not act on them)
		this._swallow = new Set(); // physical keys that no longer trigger their own name (it moved elsewhere)
		this._toggle = new Set(); // logical codes that latch
		this._latch = new Set();
		this._latchMoved = false;
		this._padMap = {}; // logical -> gamepad button index
		this.touchMode = false;
		this._touchHeld = new Set(); // logical codes held by the touch controls
		this._lmbTouch = false;
		this._rmbTouch = false;
		this._touchT = - 1e9; // the last touch (ms): mouse events right after it are the browser's copies of the tap
		const touched = () => { this._touchT = now(); };
		window.addEventListener( 'touchstart', touched, { capture: true, passive: true } );
		window.addEventListener( 'touchend', touched, { capture: true, passive: true } );

		window.addEventListener( 'keydown', ( e ) => this._keydown( e ) );
		window.addEventListener( 'keyup', ( e ) => {

			for ( const code of this.logical( e.code ) ) this.keys.delete( code );

		} );
		window.addEventListener( 'blur', () => {

			this.keys.clear();
			this._latch.clear();
			this.releaseButtons();

		} );

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( this._fromTouch( e ) ) return;
			if ( e.button === 0 ) this._setLeft( 'mouse', true );
			if ( e.button === 2 ) this._rmbMouse = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this._setLeft( 'mouse', false );
			if ( e.button === 2 ) this._rmbMouse = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this._fromTouch( e ) ) return;
			// a mouseup the page never saw (a context menu, the lock changing hands): `buttons` says what is held
			if ( typeof e.buttons === 'number' ) {

				if ( this._rmbMouse && ! ( e.buttons & 2 ) ) this._rmbMouse = false;
				if ( this._lmbMouse && ! ( e.buttons & 1 ) ) this._setLeft( 'mouse', false );

			}

			if ( this.locked || this._lmb || this.rightDown ) {

				// sensitivity applies to the mouse only (the gamepad adds to `look` itself)
				this.look.x += ( e.movementX || 0 ) * this.sensitivity;
				this.look.y += ( e.movementY || 0 ) * this.sensitivity;

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			const was = this.locked;
			this.locked = document.pointerLockElement === dom;
			// the lock went (Esc, a panel, alt-tab): whatever it held is let go
			if ( was && ! this.locked ) this.releaseButtons();

		} );
		document.addEventListener( 'fullscreenchange', () => this._onFullscreen() );

	}

	requestLock() {

		// a finger has nothing to capture (and a phone has no pointer lock)
		if ( this.touchMode || now() - this._touchT < 1000 ) return;
		if ( ! this.locked ) this.dom.requestPointerLock?.()?.catch?.( () => {} );

	}

	// a mouse event the browser made up from a touch (Chrome says so; elsewhere: within 800 ms of a touch)
	_fromTouch( e ) {

		if ( e && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents ) return true;
		return now() - this._touchT < 800;

	}

	// ---- touch (ui/TouchControls.js)

	setTouchKeys( codes ) {

		const want = codes instanceof Set ? codes : new Set( codes || [] );
		for ( const code of this._touchHeld ) {

			if ( want.has( code ) ) continue;
			this.keys.delete( code );
			this._touchHeld.delete( code );

		}

		for ( const code of want ) {

			if ( this._touchHeld.has( code ) ) {

				this.keys.add( code ); // (something cleared the keys under it: the menu, a blur)
				continue;

			}

			if ( ! this.keys.has( code ) ) this.pressed.add( code );
			this.keys.add( code );
			this._touchHeld.add( code );

		}

	}

	setTouchButton( which, down ) {

		down = !! down;
		if ( which === 'right' ) this._rmbTouch = down;
		else this._setLeft( 'touch', down );

	}

	addTouchLook( x, y ) {

		if ( Number.isFinite( x ) ) this.look.x += x;
		if ( Number.isFinite( y ) ) this.look.y += y;

	}

	releaseTouch() {

		this.setTouchKeys( NONE );
		this._rmbTouch = false;
		if ( this._lmbTouch ) this._setLeft( 'touch', false );

	}

	// ---- keys

	_keydown( e ) {

		if ( isTyping( e.target ) ) return;
		// Ctrl / Cmd + a key is a browser shortcut, never a game key (AltGr types with Ctrl + Alt: those pass)
		if ( ( e.ctrlKey || e.metaKey ) && ! e.altKey ) {

			this._shortcut( e );
			return;

		}

		const codes = this.logical( e.code );
		for ( const code of codes ) {

			if ( this._toggle.has( code ) ) {

				// a latched key switches on its first press and off on the next (key repeat is ignored)
				if ( ! e.repeat && ! this.keys.has( code ) ) {

					if ( this._latch.has( code ) ) this._latch.delete( code );
					else this._latch.add( code );
					this._latchMoved = false;

				}

				this.keys.add( code );
				continue;

			}

			if ( ! this.keys.has( code ) ) this.pressed.add( code );
			this.keys.add( code );

		}

		if ( PREVENT.has( e.code ) || this._bound.has( e.code ) ) e.preventDefault();
		else if ( FN_KEYS.has( e.code ) && this.gameFocused() ) {

			if ( e.code === 'F11' ) {

				e.preventDefault();
				if ( ! e.repeat && ! e.shiftKey ) this.toggleFullscreen();

			} else if ( e.code === 'F5' ) {

				// a reload mid-game loses what the autosave has not written: kept only while the mouse is captured
				if ( this.locked && ! e.shiftKey ) e.preventDefault();

			} else e.preventDefault();

		}

	}

	// Ctrl / Cmd + key
	_shortcut( e ) {

		const code = e.code;
		if ( e.shiftKey && DEVTOOLS.has( code ) ) return; // Ctrl+Shift+I / J / C: the developer tools
		if ( ! this.gameFocused() ) return;
		if ( CTRL_KEEP.has( code ) || ( this.keyboardLocked && CTRL_LOCKED.has( code ) ) ) e.preventDefault();
		if ( code === 'KeyS' && ! e.repeat && ! e.shiftKey && this.onShortcut ) {

			try { this.onShortcut( 'save' ); } catch ( err ) { console.warn( 'quick save failed', err ); }

		}

	}

	// the game has the keyboard: no text field focused (the canvas, the page body or nothing)
	gameFocused() {

		const d = typeof document !== 'undefined' ? document : null;
		const a = d && d.activeElement;
		if ( ! a || a === d.body || a === d.documentElement || a === this.dom ) return true;
		return ! isTyping( a );

	}

	// ---- the mouse buttons

	get rightDown() {

		return this._rmbMouse || this._rmbExt || this._rmbTouch;

	}

	// (the gamepad's left trigger drives the right button through this)
	set rightDown( v ) {

		this._rmbExt = !! v;

	}

	// every button up for the game (blur, the lock lost); bumps `releases` so latched actions drop too
	releaseButtons() {

		this._rmbMouse = this._rmbExt = this._rmbTouch = false;
		this._lmbMouse = this._lmbExt = this._lmbTouch = false;
		this._pressLeft( false );
		this._reelLatch = false;
		this.releases ++;

	}

	_setLeft( src, down ) {

		if ( src === 'mouse' ) this._lmbMouse = down;
		else if ( src === 'touch' ) this._lmbTouch = down;
		else this._lmbExt = down;
		this._pressLeft( this._lmbMouse || this._lmbExt || this._lmbTouch );

	}

	// ---- fullscreen and the keyboard lock

	get fullscreen() {

		return typeof document !== 'undefined' && !! document.fullscreenElement;

	}

	// the whole page goes fullscreen (the HUD lives beside the canvas); returns a promise or null
	toggleFullscreen( on = ! this.fullscreen ) {

		if ( typeof document === 'undefined' ) return null;
		try {

			let p = null;
			if ( on ) {

				const el = document.documentElement;
				if ( ! el || ! el.requestFullscreen ) return null;
				p = el.requestFullscreen( { navigationUI: 'hide' } );

			} else {

				if ( ! document.fullscreenElement || ! document.exitFullscreen ) return null;
				p = document.exitFullscreen();

			}

			return p && p.catch ? p.catch( () => {} ) : p;

		} catch ( e ) {

			return null;

		}

	}

	_onFullscreen() {

		const on = this.fullscreen;
		const kb = typeof navigator !== 'undefined' ? navigator.keyboard : null;
		if ( on && kb && kb.lock ) {

			// Ctrl+W / T / N and friends reach the game while fullscreen (Escape stays the browser's: held, it leaves)
			try {

				const p = kb.lock( LOCK_KEYS );
				this.keyboardLocked = true;
				if ( p && p.catch ) p.catch( () => { this.keyboardLocked = false; } );

			} catch ( e ) { this.keyboardLocked = false; }

		} else if ( ! on ) {

			if ( this.keyboardLocked && kb && kb.unlock ) try { kb.unlock(); } catch ( e ) { /* nothing was held */ }
			this.keyboardLocked = false;

		}

		if ( this.onFullscreen ) try { this.onFullscreen( on ); } catch ( e ) { console.warn( 'fullscreen listener failed', e ); }

	}

	// ---- key remapping

	// map: logical code -> physical key code. Only the keys that differ from the default are needed.
	setBindings( map = {} ) {

		this._bindings = { ...map };
		const table = new Map();
		const moved = new Set();
		for ( const [ logical, physical ] of Object.entries( this._bindings ) ) {

			moved.add( logical );
			if ( ! physical ) continue; // an unbound action: nothing triggers it
			if ( ! table.has( physical ) ) table.set( physical, [] );
			table.get( physical ).push( logical );

		}

		// a logical code that moved no longer answers to its own physical key (unless another action was put there)
		this._swallow = new Set( [ ...moved ].filter( ( c ) => ! table.has( c ) ) );
		this._table = table;
		this._bound = new Set( table.keys() );
		// whatever was held under the old table is meaningless now
		this.keys.clear();
		this._latch.clear();
		return this;

	}

	getBindings() {

		return { ...this._bindings };

	}

	// the logical codes a physical key press stands for
	logical( physical ) {

		const mapped = this._table.get( physical );
		if ( ! mapped ) return this._swallow.has( physical ) ? NONE : [ physical ];
		// the physical key's own name still passes through unless that code was itself moved away
		return physical in this._bindings ? mapped : [ ...mapped, physical ];

	}

	// the physical key that triggers a logical code now ( 'KeyE' -> 'KeyG' ); the code itself when it was not remapped
	physicalFor( logical ) {

		return logical in this._bindings ? this._bindings[ logical ] : logical;

	}

	// logical codes that latch instead of following the key (sprint toggle); `on` false releases them
	setToggle( codes, on ) {

		for ( const c of codes ) {

			if ( on ) this._toggle.add( c );
			else {

				this._toggle.delete( c );
				this._latch.delete( c );

			}

		}

	}

	// gamepad: the button index that triggers a logical code (core/Gamepad.js passes its default)
	setPadBindings( map = {} ) {

		this._padMap = { ...map };

	}

	padButton( code, fallback ) {

		const i = this._padMap[ code ];
		return Number.isInteger( i ) ? i : fallback;

	}

	// ---- reading

	get mouseDown() {

		// with the reel as a toggle and a fish on, the button state is the latch: click to reel, click to stop
		if ( this.reelToggle && this._reelOn() ) return this._reelLatch;
		return this._lmb;

	}

	// (the gamepad drives the left button through the same setter)
	set mouseDown( v ) {

		this._setLeft( 'ext', !! v );

	}

	_reelOn() {

		try {

			return !! ( this.reelActive && this.reelActive() );

		} catch ( e ) {

			return false;

		}

	}

	_pressLeft( down ) {

		if ( down === this._lmb ) return;
		this._lmb = down;
		// the click that strikes starts the fight with the reel off; later clicks flip it
		if ( down ) this._reelLatch = this.reelToggle && this._reelOn() ? ! this._reelLatch : false;

	}

	down( code ) {

		return this.enabled && ( this.keys.has( code ) || this._latch.has( code ) );

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && this.pressed.has( code );

	}

	consumeLook() {

		const l = { x: this.look.x, y: this.invertY ? - this.look.y : this.look.y };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	endFrame() {

		this.pressed.clear();
		if ( this._latch.size ) {

			// a latched sprint ends when the walker stops (it may be switched on while standing still: it waits for the first step)
			const moving = this.keys.has( 'KeyW' ) || this.keys.has( 'KeyA' ) || this.keys.has( 'KeyS' ) || this.keys.has( 'KeyD' );
			if ( moving ) this._latchMoved = true;
			else if ( this._latchMoved || ! this.enabled ) {

				this._latch.clear();
				this._latchMoved = false;

			}

		}

	}

}

const NONE = Object.freeze( [] );
const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );
// keys the page would otherwise scroll or move focus with
const PREVENT = new Set( [ 'Space', 'ArrowUp', 'ArrowDown', 'Tab' ] );
// plain function keys the game keeps while it has the focus: help, find, reload (with care), fullscreen
const FN_KEYS = new Set( [ 'F1', 'F3', 'F5', 'F11' ] );
// Ctrl / Cmd + these: save, print, bookmark, open, view source, find, find next, history
export const CTRL_KEEP = new Set( [ 'KeyS', 'KeyP', 'KeyD', 'KeyO', 'KeyU', 'KeyF', 'KeyG', 'KeyH' ] );
// and with the keyboard locked (fullscreen) the ones a page cannot stop otherwise: close, new tab / window, reopen, reload, quit
const CTRL_LOCKED = new Set( [ 'KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyQ', 'Tab', 'PageUp', 'PageDown' ] );
const DEVTOOLS = new Set( [ 'KeyI', 'KeyJ', 'KeyC' ] );
// what navigator.keyboard.lock() takes while fullscreen: the letters but I / J / C (the devtools stay the browser's),
// the digits (Ctrl+1..9 switch tabs), Tab, the arrows and the function keys but F12. Escape is not locked.
export const LOCK_KEYS = [
	...'ABDEFGHKLMNOPQRSTUVWXYZ'.split( '' ).map( ( c ) => 'Key' + c ),
	...'0123456789'.split( '' ).map( ( d ) => 'Digit' + d ),
	'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
	'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11',
];

// a form field has the keys (any input: a focused slider or checkbox answers Space and the arrows itself)
const isTyping = ( t ) => !! t && ( !! t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' );
