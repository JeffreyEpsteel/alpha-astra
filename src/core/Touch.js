// Touch maths and device detection for the mobile version (phones, tablets). No DOM in here: ui/TouchControls.js
// draws the controls and feeds core/Input.js; core/Quality.js reads detectDevice() for its mobile path; the world
// map uses pinchStep(). test/feature-mobile.mjs drives all of it from plain node.
//
//   detectDevice( env = globalThis ) -> { touch, coarse, fine, small, phone, tablet, mobile, ios, android, ipad,
//                                          appleSilicon, landscape, webgpu }
//     touch: the screen takes touches (a touch laptop too); coarse: the primary pointer is a finger (phones, tablets);
//     small: the short screen side is under 600 CSS px (a phone); mobile = phone || tablet. A touch laptop is
//     touch && ! mobile: it keeps its keyboard and mouse, the touch controls only show once a finger is used.
//   stickVector( dx, dy, radius )    the left stick: finger offset (px) from the stick centre -> { x, y, mag, sprint,
//                                    kx, ky } (x right, y down, mag 0..1 after the dead zone; sprint once the finger
//                                    is past the outer ring; kx / ky the knob offset in px, clamped to the base)
//   stickKeys( v, out )              -> Set of logical key codes ( KeyW / KeyA / KeyS / KeyD, ShiftLeft ): 8 sectors
//   lookDelta( dx, dy, { sensitivity, invert } )  a right-half drag (px) -> mouse counts for input.look
//   pinchStep( a0, b0, a1, b1 )      two fingers from ( a0, b0 ) to ( a1, b1 ) -> { scale, cx, cy, dx, dy }
//   boatThrottleKeys( v, out )       the boat lever ( -1..1, notched ) -> W ( + Shift ) / S, as the keyboard drives it
//   snapThrottle( v )                the lever's notch: -0.6 astern, 0 stop, 0.7 ahead, 1 full
//   planeDragKeys( dx, dy, dead, out ) the seaplane's right-half drag: up = nose down (W), down = nose up (S), sides bank
//   planeThrottleKeys( target, current, out ) the seaplane slider -> ShiftLeft (more) / KeyC (less) until it is there
//   promptAction( prompt )           the game's prompt ( p.prompt = { key, text } ) -> { code } | { button } | null
//   contextButtons( s )              which action buttons show for a snapshot of the game -> Set of ids
//   buttonIsOn( id, s )              a toggle button's lit state from the snapshot (lights, nav, landing)
//   fightOn( s )                     a melee or boarding fight is on (the fold's handle hides, dodge / guard come up)
//   splitButtons( set, mode, opts )  contextButtons' set -> { primary, tray }: what stays on screen, what folds away
//   FoldState                        the fold / rail state machine (open on tap or drag, idle close, hidden in fights)
//   tabStripLayout( width, count )   the settings panel's tab chips: how many per row, how many rows, room for a label

export const STICK = { dead: 0.16, ring: 1.18, sector: 0.38 };
export const LOOK_PX = 1.7; // mouse counts per CSS px of drag at sensitivity 1 (Player turns 0.0022 rad per count)

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

function mq( env, q ) {

	try { return !! ( env.matchMedia && env.matchMedia( q ).matches ); } catch ( e ) { return false; }

}

export function detectDevice( env = globalThis ) {

	const nav = env.navigator || {};
	const ua = String( nav.userAgent || '' );
	const points = Number( nav.maxTouchPoints ) || 0;
	const scr = env.screen || {};
	const sw = Number( scr.width ) || Number( env.innerWidth ) || 1280;
	const sh = Number( scr.height ) || Number( env.innerHeight ) || 720;
	const short = Math.min( sw, sh );
	const coarse = mq( env, '(pointer: coarse)' );
	const anyCoarse = mq( env, '(any-pointer: coarse)' );
	const fine = mq( env, '(pointer: fine)' );
	const android = /Android/i.test( ua );
	const iphone = /iPhone|iPod/i.test( ua );
	// iPadOS asks for the desktop site: a "Macintosh" with a touch screen is an iPad
	const ipad = /iPad/i.test( ua ) || ( /Macintosh/i.test( ua ) && points > 1 );
	const ios = iphone || ipad;
	const touch = points > 0 || anyCoarse || coarse;
	const small = short < 600;
	const phone = iphone || ( android && ( small || /Mobile/i.test( ua ) ) ) || ( coarse && small && ! fine );
	const tablet = ! phone && ( ipad || android || ( coarse && ! fine ) );
	// an M-series iPad: 8 or more cores (the A-series iPads report 6 or fewer)
	const cores = Number( nav.hardwareConcurrency ) || 0;
	const appleSilicon = ipad && cores >= 8;
	return {
		touch, coarse, fine, small, phone, tablet, mobile: phone || tablet, ios, android, ipad, appleSilicon,
		landscape: Number( env.innerWidth || sw ) >= Number( env.innerHeight || sh ),
		webgpu: !! nav.gpu,
	};

}

// ---- the left stick

export function stickVector( dx, dy, radius, { dead = STICK.dead, ring = STICK.ring } = {} ) {

	const r = Math.max( 1, radius );
	const d = Math.hypot( dx, dy );
	const raw = d / r;
	const k = d > 0 ? Math.min( d, r ) / d : 0;
	const kx = dx * k, ky = dy * k;
	if ( raw <= dead ) return { x: 0, y: 0, mag: 0, sprint: false, kx, ky };
	const mag = clamp( ( raw - dead ) / ( 1 - dead ), 0, 1 );
	return { x: dx / d * mag, y: dy / d * mag, mag, sprint: raw >= ring, kx, ky };

}

// 8 sectors: a key is held when the direction's component is past sin 22.5° (the diagonals hold two)
export function stickKeys( v, out = new Set() ) {

	if ( ! v || ! ( v.mag > 0 ) ) return out;
	const s = STICK.sector, nx = v.x / v.mag, ny = v.y / v.mag;
	if ( ny < - s ) out.add( 'KeyW' );
	if ( ny > s ) out.add( 'KeyS' );
	if ( nx < - s ) out.add( 'KeyA' );
	if ( nx > s ) out.add( 'KeyD' );
	if ( v.sprint ) out.add( 'ShiftLeft' );
	return out;

}

// ---- look and pinch

export function lookDelta( dx, dy, { sensitivity = 1, invert = false } = {} ) {

	const k = LOOK_PX * clamp( Number.isFinite( sensitivity ) ? sensitivity : 1, 0.1, 5 );
	return { x: dx * k, y: ( invert ? - dy : dy ) * k };

}

// a0 / b0: the two fingers before, a1 / b1 after ( { x, y } ). scale > 1 spreads (zoom in); cx / cy the new midpoint
// (zoom about it), dx / dy how far the midpoint moved (pan with it)
export function pinchStep( a0, b0, a1, b1 ) {

	const d0 = Math.hypot( b0.x - a0.x, b0.y - a0.y ), d1 = Math.hypot( b1.x - a1.x, b1.y - a1.y );
	const scale = d0 > 4 && d1 > 0 ? clamp( d1 / d0, 0.5, 2 ) : 1;
	const m0x = ( a0.x + b0.x ) / 2, m0y = ( a0.y + b0.y ) / 2, cx = ( a1.x + b1.x ) / 2, cy = ( a1.y + b1.y ) / 2;
	return { scale, cx, cy, dx: cx - m0x, dy: cy - m0y };

}

// ---- vehicles

// the boat reads W (0.7, with Shift 1) and S (-0.6): the slider snaps to those notches
export function snapThrottle( v ) {

	v = clamp( Number( v ) || 0, - 1, 1 );
	if ( v > 0.85 ) return 1;
	if ( v > 0.2 ) return 0.7;
	if ( v < - 0.2 ) return - 0.6;
	return 0;

}

export function boatThrottleKeys( v, out = new Set() ) {

	const n = snapThrottle( v );
	if ( n > 0 ) out.add( 'KeyW' );
	if ( n >= 1 ) out.add( 'ShiftLeft' );
	if ( n < 0 ) out.add( 'KeyS' );
	return out;

}

// the seaplane: drag up = stick forward = nose down (W), drag down = nose up (S), left / right banks (A / D)
export function planeDragKeys( dx, dy, dead = 18, out = new Set() ) {

	if ( dy < - dead ) out.add( 'KeyW' );
	if ( dy > dead ) out.add( 'KeyS' );
	if ( dx < - dead ) out.add( 'KeyA' );
	if ( dx > dead ) out.add( 'KeyD' );
	return out;

}

// the seaplane's throttle moves while Shift / C are held: hold the one that brings it to the slider
export function planeThrottleKeys( target, current, out = new Set(), eps = 0.04 ) {

	if ( ! Number.isFinite( target ) || ! Number.isFinite( current ) ) return out;
	if ( target > current + eps ) out.add( 'ShiftLeft' );
	else if ( target < current - eps ) out.add( 'KeyC' );
	return out;

}

// ---- prompts and context buttons

const PROMPT_CODES = { E: 'KeyE', R: 'KeyR', F: 'KeyF', B: 'KeyB', Q: 'KeyQ', V: 'KeyV', Space: 'Space', SPACE: 'Space' };

// p.prompt.key is the logical key the game named ( 'E', 'Space', 'LMB', 'RMB', '$', '…' )
export function promptAction( prompt ) {

	const k = prompt && prompt.key != null ? String( prompt.key ).trim() : '';
	if ( ! k ) return null;
	if ( k === 'LMB' ) return { button: 'left' };
	if ( k === 'RMB' ) return { button: 'right' };
	if ( PROMPT_CODES[ k ] ) return { code: PROMPT_CODES[ k ] };
	if ( /^Key[A-Z]$|^Digit\d$/.test( k ) ) return { code: k };
	if ( /^[A-Z]$/.test( k ) ) return { code: 'Key' + k };
	return null; // '$', '…': information, not an action

}

// s: { mode: 'walk' | 'deck' | 'ride' | 'seat' | 'swim' | 'boat' | 'plane', busy, rod: bool (equipped), canFish,
//      rodState, fight, prompt, guns: bool, boardOffer: bool, boardFight: bool, choices: bool (a 1 / 2 choice is
//      asked: a surrender, the boarders' terms), melee: bool, freeCam }
// -> Set of: interact, rod, cast, reel (right button: empty line / guard), jump, dodge, guard, fireL, fireR, board,
//    camera, throttle (the boat lever), planeThrottle, dive, choice1, choice2, lights (boat), navLights + landing (plane)
//    boatLights / planeNav / planeLanding (bool) are the toggles' state: see buttonIsOn
export function contextButtons( s = {} ) {

	const out = new Set();
	if ( s.busy ) return out;
	const mode = s.mode || 'walk';
	const act = promptAction( s.prompt );
	if ( act && act.code ) out.add( 'interact' );
	if ( s.freeCam ) return out;
	const onFoot = mode === 'walk' || mode === 'deck' || mode === 'ride' || mode === 'seat' || mode === 'aboard';
	if ( onFoot && ( s.canFish || s.rod ) && ! s.fight ) out.add( 'rod' );
	if ( s.rod ) {

		out.add( 'cast' );
		const st = s.rodState;
		if ( st === 'floating' || st === 'retrieving' ) out.add( 'reel' );

	}

	if ( mode === 'walk' || mode === 'swim' ) out.add( 'jump' );
	if ( mode === 'walk' || mode === 'deck' ) out.add( 'emote' );
	if ( mode === 'swim' ) out.add( 'dive' );
	if ( mode === 'walk' && s.melee ) {

		out.add( 'dodge' );
		if ( ! s.rod && ! s.gunDrawn ) out.add( 'guard' );

	}

	// a pistol / musket: Gun draws it on foot, then Fire and Aim replace the melee swing
	if ( onFoot && s.gunOwned && ! s.fight ) out.add( 'draw' );
	if ( s.gunDrawn || s.weaponMouse ) { out.add( 'fire' ); if ( s.gunDrawn ) out.add( 'aim' ); }
	if ( onFoot && s.weaponOwned && ! s.fight ) out.add( 'weapon' ); // wave 18D: cycle the quick slots
	if ( s.canFlare ) out.add( 'flare' ); // wave 15D: a distress flare where one makes sense

	if ( mode === 'boat' ) {

		out.add( 'throttle' );
		out.add( 'camera' );
		out.add( 'lights' ); // L: root toggles the lights of every hull
		if ( s.helmAshore ) out.add( 'deck' ); // (E = step ashore then; Q = the deck)
		if ( s.guns ) {

			out.add( 'fireL' );
			out.add( 'fireR' );

		}

	}

	if ( mode === 'plane' ) {

		out.add( 'planeThrottle' );
		out.add( 'camera' );
		out.add( 'cockpit' );
		out.add( 'navLights' ); // N
		out.add( 'landing' ); // ;
		out.add( 'bail' ); // the parachute (twice within 2 s)
		if ( s.planeWheels ) out.add( 'brake' );
		if ( s.planeSearch ) out.add( 'search' );

	}

	if ( s.boardOffer || s.boardFight ) out.add( 'board' );
	if ( s.choices ) {

		out.add( 'choice1' );
		out.add( 'choice2' );

	}

	return out;

}

// the toggles show lit while the thing is on (the snapshot's booleans)
const TOGGLE_FLAG = { lights: 'boatLights', navLights: 'planeNav', landing: 'planeLanding' };

export function buttonIsOn( id, s = {} ) {

	const flag = TOGGLE_FLAG[ id ];
	return !! ( flag && s[ flag ] );

}

// ---- the fold (wave 10E): on touch only the primary controls stay on screen, the rest sits in a tray under a handle

// what folds away, in tray order (the interact button, the lever, cast / fire / reel, board and the 1 / 2 choices stay)
export const TRAY_ORDER = [ 'rod', 'jump', 'dive', 'draw', 'aim', 'dodge', 'guard', 'emote', 'camera', 'deck', 'cockpit', 'lights', 'navLights', 'landing', 'bail', 'brake', 'search', 'flare', 'weapon', 'fireL', 'fireR' ];
const TRAY_SET = new Set( TRAY_ORDER );
// in a fight these come up beside the primary buttons so the fight stays playable (the rest is dropped: the handle is gone)
const FIGHT_PRIMARY = new Set( [ 'dodge', 'guard', 'aim' ] );

export function fightOn( s = {} ) {

	return !! ( s.melee || s.boardFight );

}

// set: contextButtons( s ); mode: s.mode; { fight }: fightOn( s ) -> { primary: Set, tray: Set } (disjoint, tray in TRAY_ORDER).
// The seaplane keeps only the yoke (the look area), the lever and the interact button on screen: its tray is
// camera, cockpit, nav, landing. No tray at all in a fight.
export function splitButtons( set, mode = 'walk', { fight = false } = {} ) {

	const primary = new Set(), tray = new Set();
	if ( ! set ) return { primary, tray };
	// no fold anywhere (user 2026-10-13: the toggle UI was worse than the full layout); the plane's extra buttons are a compact
	// cluster instead (TouchControls 'is-compact'). splitButtons stays for the tests and a future opt-in.
	if ( ! splitButtons.enabled ) { for ( const id of set ) primary.add( id ); return { primary, tray }; }
	for ( const id of set ) {

		if ( ! TRAY_SET.has( id ) ) primary.add( id );
		else if ( fight && FIGHT_PRIMARY.has( id ) ) primary.add( id );

	}

	if ( ! fight ) for ( const id of TRAY_ORDER ) if ( set.has( id ) ) tray.add( id );
	return { primary, tray };

}

// The fold's state machine, pure (no DOM, the caller passes the clock in ms): the handle opens the tray on a tap or an upward
// drag, closes it on a tap, a downward drag or after `idle` ms without a press; a held button (jump, dive) keeps it open;
// a fight hides the handle. Remembers the open state per mode (this session only). The top-right rail uses another
// instance: toggle() on its button, keep() while a panel is open, tick() closes it after 6 s.
splitButtons.enabled = false;

export class FoldState {

	constructor( { idle = 5000, drag = 28, tap = 10 } = {} ) {

		this.idle = idle;
		this.drag = drag; // px of vertical travel that counts as a drag
		this.tap = tap; // under this much travel a press is a tap
		this.open = false;
		this.hidden = false;
		this.holds = 0; // buttons held down right now
		this.mode = null;
		this.mem = {};
		this._g = null; // the handle gesture: { y0, done }
		this._t = 0; // time of the last press / gesture

	}

	toggle( now = 0 ) {

		return this.setOpen( ! this.open, now );

	}

	setOpen( on, now = 0 ) {

		this._t = now;
		this.open = !! on && ! this.hidden;
		return this.open;

	}

	close() {

		this.open = false;
		this._g = null;

	}

	// a fight (or no tray buttons): the handle goes, the tray with it
	setHidden( on, now = 0 ) {

		on = !! on;
		if ( on === this.hidden ) return;
		this.hidden = on;
		this._t = now;
		if ( on ) this.close();

	}

	// a new mode (boat, plane, walk...): its own open state, as left in this session; closed the first time
	setMode( mode, now = 0 ) {

		if ( mode === this.mode ) return false;
		if ( this.mode !== null ) this.mem[ this.mode ] = this.open;
		this.mode = mode;
		this.open = ! this.hidden && !! this.mem[ mode ];
		this._t = now;
		this._g = null;
		return true;

	}

	// the handle: down( y ) -> move( y )... -> up( y ). move / up return 'open' | 'close' | null (what changed)
	down( y, now = 0 ) {

		if ( this.hidden ) return false;
		this._g = { y0: y, done: false };
		this._t = now;
		return true;

	}

	move( y, now = 0 ) {

		const g = this._g;
		if ( ! g || g.done ) return null;
		const dy = y - g.y0;
		this._t = now;
		if ( dy <= - this.drag && ! this.open ) { g.done = true; this.open = true; return 'open'; }
		if ( dy >= this.drag && this.open ) { g.done = true; this.open = false; return 'close'; }
		return null;

	}

	up( y, now = 0 ) {

		const g = this._g;
		this._g = null;
		this._t = now;
		if ( ! g || g.done || this.hidden ) return null;
		if ( Math.abs( y - g.y0 ) >= this.tap ) return null;
		this.open = ! this.open;
		return this.open ? 'open' : 'close';

	}

	cancel() {

		this._g = null;

	}

	// a tray button goes down / up: the idle clock restarts, and a held one keeps the tray open
	press( now = 0 ) {

		this.holds ++;
		this._t = now;

	}

	release( now = 0 ) {

		this.holds = Math.max( 0, this.holds - 1 );
		this._t = now;

	}

	keep( now = 0 ) {

		this._t = now;

	}

	// per frame: closes after `idle` ms without a press (never while one is held or the handle is being dragged)
	tick( now = 0 ) {

		if ( ! this.open || this.holds > 0 || this._g ) return false;
		if ( now - this._t < this.idle ) return false;
		this.open = false;
		return true;

	}

}

// ---- the settings panel's tab strip (ui/UI.js)

// The chips wrap onto rows and the strip never scrolls, so every tab stays reachable. width: the strip's inner width (px);
// count: the tabs; the active tab shows its name, which makes it wider (activeIndex; -1: none). -> { perRow, rows, labels }
// perRow: chips of the plain width per row; rows: rows needed (with the active label if it fits); labels: the active tab's
// name fits without costing an extra row (else UI.js shows icons only).
export function tabStripLayout( width, count, { chip = 40, gap = 3, label = 137, activeIndex = 0 } = {} ) {

	count = Math.max( 0, Math.floor( Number( count ) || 0 ) );
	const w = Math.max( chip, Number( width ) || 0 );
	const perRow = Math.max( 1, Math.floor( ( w + gap ) / ( chip + gap ) ) );
	const plainRows = count ? Math.ceil( count / perRow ) : 0;
	const pack = ( withLabel ) => {

		let rows = count ? 1 : 0, used = 0;
		for ( let i = 0; i < count; i ++ ) {

			const cw = chip + ( withLabel && i === activeIndex ? label : 0 );
			const need = used ? used + gap + cw : cw;
			if ( need > w && used ) { rows ++; used = cw; } else used = need;

		}

		return rows;

	};

	const labelRows = pack( true );
	const labels = activeIndex >= 0 && activeIndex < count && labelRows <= plainRows;
	return { perRow, rows: labels ? labelRows : plainRows, labels };

}
