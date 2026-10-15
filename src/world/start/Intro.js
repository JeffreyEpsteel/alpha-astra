import { Vector3, Quaternion, Matrix4 } from '../../engine/index.js';
import { WORLD } from '../WorldLayout.js';
import { t } from '../../i18n/index.js';
import { brandMark } from '../../ui/icons.js';

// The first-start intro: a short camera glide in from the bay to the player on Jade Landing with a
// "Hyptile Island" title card in the main menu's look. Campaign only, once per save slot (localStorage
// INTRO_KEY + mode + slot), never under ?bench / ?bg / ?nomenu. Any key or click skips it.
//
//   const intro = new Intro( app );
//   intro.request( { mode, slot } )   // App.startSession -> plays after the start overlay is dismissed; false when not allowed
//   intro.update( dt )                 // per frame AFTER the player has set the camera (features.update does): overrides it
//   intro.skip(), intro.active, intro.pending, intro.dispose()
//
// While it waits behind the start overlay the camera holds the sea view; then it glides (from -> via -> the player's
// own third-person camera, round the sea side of the pavilion and in between its posts) over DURATION seconds, easing the view from the landing onto the player's heading. Input
// is off while it plays and restored after (unless a menu opened meanwhile).

export const INTRO_KEY = 'alpha-astra.intro.';
export const DURATION = 4.4;

export function introKey( mode, slot ) {

	return `${ INTRO_KEY }${ mode || 'campaign' }.${ slot | 0 }`;

}

// may the intro play? { mode, slot, search (location.search), storage (localStorage-like or null) }
export function introAllowed( { mode, slot = 0, search = '', storage = null } ) {

	if ( mode !== 'campaign' ) return false;
	if ( /[?&](bench|bg|nomenu)(?![A-Za-z0-9_])/.test( search ) ) return false;
	try {

		if ( storage && storage.getItem( introKey( mode, slot ) ) ) return false;

	} catch ( e ) { /* no storage: play it */ }

	return true;

}

const ease = ( x ) => ( x < 0.5 ? 4 * x * x * x : 1 - Math.pow( - 2 * x + 2, 3 ) / 2 );
const smooth = ( a, b, x ) => { const k = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return k * k * ( 3 - 2 * k ); };
const _m = new Matrix4(), _up = new Vector3( 0, 1, 0 ), _qa = new Quaternion();

// the camera at time u (0..1): on a Catmull-Rom spline through layout.path and then endPos (spaced by length, so
// the speed is even), looking at the player (the arm pivot 4.2 m in front of the end camera) and settling onto
// endQuat over the last fifth. Writes into outPos / outQuat.
const _pts = [], _f = new Vector3(), _pivot = new Vector3();
export function introPose( u, { path }, endPos, endQuat, outPos, outQuat ) {

	const s = ease( Math.min( 1, Math.max( 0, u ) ) );
	_pts.length = 0;
	_pts.push( ...path, endPos );
	const n = _pts.length - 1;
	// segment lengths -> the segment and its local t for s
	let total = 0;
	const lens = [];
	for ( let i = 0; i < n; i ++ ) { lens.push( _pts[ i ].distanceTo( _pts[ i + 1 ] ) ); total += lens[ i ]; }
	let d = s * total, i = 0;
	while ( i < n - 1 && d > lens[ i ] ) { d -= lens[ i ]; i ++; }
	const t = lens[ i ] > 0 ? Math.min( 1, d / lens[ i ] ) : 1;
	const p0 = _pts[ Math.max( 0, i - 1 ) ], p1 = _pts[ i ], p2 = _pts[ i + 1 ], p3 = _pts[ Math.min( n, i + 2 ) ];
	const t2 = t * t, t3 = t2 * t;
	const cr = ( a, b, c, e ) => 0.5 * ( 2 * b + ( - a + c ) * t + ( 2 * a - 5 * b + 4 * c - e ) * t2 + ( - a + 3 * b - 3 * c + e ) * t3 );
	outPos.set( cr( p0.x, p1.x, p2.x, p3.x ), cr( p0.y, p1.y, p2.y, p3.y ), cr( p0.z, p1.z, p2.z, p3.z ) );
	_f.set( 0, 0, - 1 ).applyQuaternion( endQuat );
	_pivot.copy( endPos ).addScaledVector( _f, 4.2 );
	_m.lookAt( outPos, _pivot, _up );
	_qa.setFromRotationMatrix( _m );
	outQuat.copy( _qa ).slerp( endQuat, smooth( 0.8, 1, s ) );
	return outPos;

}

const CSS = /* css */`
.hy-intro { position: absolute; inset: 0; z-index: 24; pointer-events: none; display: grid; align-items: end; justify-items: start;
	padding: 0 0 clamp(40px, 12vh, 140px) clamp(24px, 7vw, 140px); opacity: 0; transition: opacity 700ms var(--tw-ease, ease);
	font-family: var(--tw-font, Inter, system-ui, sans-serif); color: var(--tw-ink, #f4f8fa);
	background: linear-gradient(0deg, rgba(4, 14, 24, 0.55) 0%, rgba(4, 14, 24, 0.12) 34%, transparent 52%); }
.hy-intro.is-on { opacity: 1; }
.hy-intro-card { display: flex; flex-direction: column; gap: 10px; transform: translateY(14px); transition: transform 1100ms var(--tw-ease, ease); }
.hy-intro.is-on .hy-intro-card { transform: none; }
.hy-intro-kicker { display: flex; align-items: center; gap: 12px; font-size: clamp(10px, 1vw, 13px); font-weight: 600; letter-spacing: 0.34em;
	text-transform: uppercase; color: #ffd8a6; text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6); }
.hy-intro-kicker .tw-mark { width: 30px; height: 30px; filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.45)); }
.hy-intro-title { margin: 0; font-size: clamp(34px, 6.4vw, 104px); font-weight: 600; letter-spacing: 0.32em; line-height: 1; white-space: nowrap;
	color: transparent; background: linear-gradient(180deg, #ffffff 15%, #e9fff6 60%, #9fe6c8 100%); -webkit-background-clip: text; background-clip: text;
	filter: drop-shadow(0 2px 22px rgba(0, 0, 0, 0.5)); }
.hy-intro-rule { width: min(420px, 50vw); height: 2px; border-radius: 2px; background: linear-gradient(90deg, #ff9a7a, #f1e3c6 45%, #5cc79a); opacity: 0.85; }
.hy-intro-tag { font-size: clamp(13px, 1.25vw, 16px); color: rgba(232, 244, 248, 0.82); text-shadow: 0 1px 10px rgba(0, 0, 0, 0.7); letter-spacing: 0.04em; }
.hy-intro-skip { position: absolute; right: clamp(16px, 3vw, 40px); bottom: clamp(16px, 3vh, 36px); font-size: 12px; letter-spacing: 0.08em;
	color: rgba(232, 244, 248, 0.6); }
@media (prefers-reduced-motion: reduce) { .hy-intro, .hy-intro-card { transition: none; } }
`;

export class Intro {

	constructor( app, { layout = WORLD.landing.intro, duration = DURATION } = {} ) {

		this.app = app;
		this.layout = layout;
		this.duration = duration;
		this.pending = false;
		this.active = false;
		this.time = 0;
		this._endPos = new Vector3();
		this._endQuat = new Quaternion();
		this._pos = new Vector3();
		this._quat = new Quaternion();
		this._onKey = ( e ) => {

			if ( ! this.active || e.repeat ) return;
			this.skip();

		};

	}

	get storage() {

		try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch ( e ) { return null; }

	}

	// App.startSession: arm the intro for this slot (campaign, first time); true when it will play
	request( { mode = this.app && this.app.mode, slot = 0, force = false } = {} ) {

		const search = typeof location !== 'undefined' ? location.search : '';
		if ( ! force && ! introAllowed( { mode, slot, search, storage: this.storage } ) ) return false;
		try { if ( this.storage ) this.storage.setItem( introKey( mode, slot ), String( Date.now() ) ); } catch ( e ) { /* full or blocked */ }
		this.pending = true;
		this.active = false;
		this.time = 0;
		return true;

	}

	// the start overlay ("click to play") is still up, or a menu: wait (holding the sea view)
	_blocked() {

		const app = this.app, ui = app.ui && app.ui.ui;
		return !! ( app.menuOpen || ( ui && ui._start ) );

	}

	update( dt ) {

		if ( ! this.pending && ! this.active ) return;
		const cam = this.app.camera;
		if ( ! cam ) return;
		if ( this.pending ) {

			// a restored save far from the landing (the slot was played before the intro existed): no glide
			const st = WORLD.start.position;
			if ( Math.hypot( cam.position.x - st.x, cam.position.z - st.z ) > 40 ) { this.pending = false; return; }
			// hold the opening view from the bay behind the overlay (looking at the player on the landing)
			introPose( 0, this.layout, cam.position, cam.quaternion, this._pos, this._quat );
			if ( ! this._blocked() ) this._begin();
			else {

				cam.position.copy( this._pos );
				cam.quaternion.copy( this._quat );
				cam.updateMatrixWorld();
				return;

			}

		}

		// the player's camera this frame is where the glide lands
		this._endPos.copy( cam.position );
		this._endQuat.copy( cam.quaternion );
		this.time += Math.min( dt, 0.1 );
		const u = this.time / this.duration;
		if ( u >= 1 ) { this._finish(); return; }
		introPose( u, this.layout, this._endPos, this._endQuat, this._pos, this._quat );
		cam.position.copy( this._pos );
		cam.quaternion.copy( this._quat );
		cam.updateMatrixWorld();
		if ( this.card && u > 0.78 && ! this._fading ) this._fadeCard();

	}

	_begin() {

		this.pending = false;
		this.active = true;
		this.time = 0;
		const input = this.app.input;
		if ( input ) { input.enabled = false; if ( input.keys ) input.keys.clear(); }
		if ( typeof window !== 'undefined' ) {

			window.addEventListener( 'keydown', this._onKey, true );
			window.addEventListener( 'pointerdown', this._onKey, true );

		}

		this._showCard();

	}

	skip() {

		if ( this.pending ) { this.pending = false; return; }
		if ( this.active ) this._finish();

	}

	_finish() {

		this.active = false;
		this.pending = false;
		if ( typeof window !== 'undefined' ) {

			window.removeEventListener( 'keydown', this._onKey, true );
			window.removeEventListener( 'pointerdown', this._onKey, true );

		}

		const input = this.app.input;
		if ( input ) { input.enabled = ! this.app.menuOpen; if ( input.keys ) input.keys.clear(); }
		this._fadeCard();

	}

	// ---- the title card (DOM; skipped outside a browser)

	_showCard() {

		if ( typeof document === 'undefined' ) return;
		if ( ! document.getElementById( 'hy-intro-css' ) ) {

			const st = document.createElement( 'style' );
			st.id = 'hy-intro-css';
			st.textContent = CSS;
			document.head.appendChild( st );

		}

		const host = ( this.app.ui && this.app.ui.ui && this.app.ui.ui.root ) || document.body;
		const el = document.createElement( 'div' );
		el.className = 'hy-intro';
		el.setAttribute( 'aria-live', 'polite' );
		el.innerHTML = `<div class="hy-intro-card">
			<div class="hy-intro-kicker">${ brandMark() }<span>${ t( 'intro.kicker', 'Jade Landing · East Bay' ) }</span></div>
			<h1 class="hy-intro-title">${ t( 'intro.title', 'HYPTILE ISLAND' ) }</h1>
			<div class="hy-intro-rule"></div>
			<div class="hy-intro-tag">${ t( 'intro.tag', 'Fish the island, buy a boat from Captain Roid, and follow the boardwalk to the harbour.' ) }</div>
		</div>
		<div class="hy-intro-skip">${ t( 'intro.skip', 'Press any key to skip' ) }</div>`;
		host.appendChild( el );
		this.card = el;
		this._fading = false;
		void el.offsetWidth;
		el.classList.add( 'is-on' );

	}

	_fadeCard() {

		const el = this.card;
		if ( ! el || this._fading ) return;
		this._fading = true;
		el.classList.remove( 'is-on' );
		setTimeout( () => { el.remove(); if ( this.card === el ) this.card = null; }, 800 );

	}

	dispose() {

		this._finish();
		if ( this.card ) { this.card.remove(); this.card = null; }

	}

}
