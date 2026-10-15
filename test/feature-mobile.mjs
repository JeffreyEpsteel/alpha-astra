// Plain-node tests of the mobile version (wave 6): core/Touch.js (device detection, the stick, the look drag, the
// pinch, the vehicle levers, the context buttons), core/Input.js's touch source (key edges, buttons, look, its
// independence from the keyboard), the touch controls' held-key mapping (ui/TouchControls.js _sync without a DOM)
// and core/Quality.js's mobile path (start tier, render-scale cap, trims, saved choices).

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};

// ---- a stub browser: just enough for Input
const handlers = { window: {}, dom: {}, document: {} };
const on = ( bag ) => ( type, fn ) => ( bag[ type ] ||= [] ).push( fn );
const fire = ( bag, type, ev ) => { for ( const fn of bag[ type ] || [] ) fn( { preventDefault() {}, target: {}, repeat: false, ...ev } ); };
globalThis.window = { addEventListener: on( handlers.window ) };
globalThis.document = { addEventListener: on( handlers.document ), pointerLockElement: null, documentElement: {} };

const T = await import( '../src/core/Touch.js' );
const { Input } = await import( '../src/core/Input.js' );
const { Quality, QualityLoop, MOBILE, mobileProfile, mobileTier, TIERS, STORAGE_KEY } = await import( '../src/core/Quality.js' );
const { TouchControls } = await import( '../src/ui/TouchControls.js' );

// ---- device detection
const env = ( { ua = '', points = 0, w = 1920, h = 1080, coarse = false, fine = true, cores = 8, gpu = true } ) => ( {
	navigator: { userAgent: ua, maxTouchPoints: points, hardwareConcurrency: cores, gpu: gpu ? {} : undefined },
	screen: { width: w, height: h }, innerWidth: Math.max( w, h ), innerHeight: Math.min( w, h ),
	matchMedia: ( q ) => ( { matches: q === '(pointer: coarse)' ? coarse : q === '(any-pointer: coarse)' ? coarse || points > 0 : q === '(pointer: fine)' ? fine : false } ),
} );
{

	const iphone = T.detectDevice( env( { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit Safari', points: 5, w: 390, h: 844, coarse: true, fine: false, cores: 6 } ) );
	ok( iphone.phone && iphone.mobile && iphone.ios && ! iphone.tablet && iphone.small, 'an iPhone is a phone (iOS, small)' );
	const ipad = T.detectDevice( env( { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Safari', points: 5, w: 1180, h: 820, coarse: true, fine: false, cores: 8 } ) );
	ok( ipad.tablet && ipad.ipad && ipad.ios && ! ipad.phone && ipad.appleSilicon, 'iPadOS (a "Macintosh" with touch) is a tablet; 8 cores: M-series' );
	const oldPad = T.detectDevice( env( { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', points: 5, w: 1080, h: 810, coarse: true, fine: false, cores: 6 } ) );
	ok( oldPad.tablet && ! oldPad.appleSilicon, 'an A-series iPad is a tablet, not M-series' );
	const droid = T.detectDevice( env( { ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141 Mobile Safari', points: 5, w: 412, h: 915, coarse: true, fine: false } ) );
	ok( droid.phone && droid.android && droid.mobile, 'an Android phone is a phone' );
	const tab = T.detectDevice( env( { ua: 'Mozilla/5.0 (Linux; Android 15; SM-X910) Chrome/141 Safari', points: 10, w: 1848, h: 2960, coarse: true, fine: false } ) );
	ok( tab.tablet && ! tab.phone, 'an Android tablet is a tablet' );
	const desk = T.detectDevice( env( { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141' } ) );
	ok( ! desk.touch && ! desk.mobile && desk.webgpu, 'a desktop: no touch, not mobile' );
	const laptop = T.detectDevice( env( { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141', points: 10 } ) );
	ok( laptop.touch && ! laptop.mobile && ! laptop.coarse, 'a touch laptop: touch but not mobile (keeps its keyboard)' );
	ok( T.detectDevice( env( { gpu: false } ) ).webgpu === false, 'no navigator.gpu is reported' );
	ok( ! T.detectDevice( {} ).mobile, 'an empty environment (node) is a desktop' );

}

// ---- the stick
{

	const r = 54;
	let v = T.stickVector( 3, 4, r );
	ok( v.mag === 0 && v.x === 0 && ! v.sprint, 'inside the dead zone: no movement' );
	v = T.stickVector( 0, - 54, r );
	ok( near( v.mag, 1 ) && near( v.y, - 1 ) && ! v.sprint && near( v.ky, - 54 ), 'full deflection up: mag 1, knob at the rim, no sprint' );
	v = T.stickVector( 0, - 80, r );
	ok( v.sprint && near( v.mag, 1 ) && near( v.ky, - 54 ), 'past the outer ring: sprint, the knob stays on the rim' );
	v = T.stickVector( 27 + 54 * T.STICK.dead / 2, 0, r );
	ok( v.mag > 0 && v.mag < 1 && v.x > 0, 'half way: an analogue magnitude' );
	ok( [ ...T.stickKeys( T.stickVector( 0, - 40, r ) ) ].join() === 'KeyW', 'up holds W only' );
	const diag = T.stickKeys( T.stickVector( 30, 30, r ) );
	ok( diag.has( 'KeyS' ) && diag.has( 'KeyD' ) && diag.size === 2, 'down-right holds S and D' );
	const shallow = T.stickKeys( T.stickVector( 40, - 8, r ) );
	ok( shallow.has( 'KeyD' ) && ! shallow.has( 'KeyW' ), 'a shallow angle stays one key (8 sectors)' );
	ok( T.stickKeys( T.stickVector( 0, - 90, r ) ).has( 'ShiftLeft' ), 'the ring adds Shift (sprint / boost)' );
	ok( T.stickKeys( { mag: 0 } ).size === 0 && T.stickKeys( null ).size === 0, 'no vector: no keys' );

}

// ---- look, pinch
{

	const d = T.lookDelta( 10, - 5, { sensitivity: 2 } );
	ok( near( d.x, 10 * T.LOOK_PX * 2 ) && near( d.y, - 5 * T.LOOK_PX * 2 ), 'look: px times LOOK_PX times sensitivity' );
	ok( near( T.lookDelta( 0, 10, { invert: true } ).y, - 10 * T.LOOK_PX ), 'invert flips the vertical' );
	ok( near( T.lookDelta( 10, 0, { sensitivity: 99 } ).x, 10 * T.LOOK_PX * 5 ), 'sensitivity is clamped' );
	const p = T.pinchStep( { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 80, y: 100 }, { x: 220, y: 100 } );
	ok( near( p.scale, 1.4 ) && near( p.cx, 150 ) && near( p.dx, 0 ), 'spreading the fingers zooms in about their midpoint' );
	const q = T.pinchStep( { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 20 }, { x: 110, y: 20 } );
	ok( near( q.scale, 1 ) && near( q.dx, 10 ) && near( q.dy, 20 ), 'two fingers moving together pan' );
	ok( T.pinchStep( { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 300, y: 0 } ).scale === 1, 'fingers on top of each other: no wild zoom' );

}

// ---- vehicles
{

	ok( T.snapThrottle( 0.1 ) === 0 && T.snapThrottle( 0.5 ) === 0.7 && T.snapThrottle( 0.95 ) === 1 && T.snapThrottle( - 0.4 ) === - 0.6, 'the boat lever snaps to stop / ahead / full / astern' );
	ok( [ ...T.boatThrottleKeys( 1 ) ].sort().join() === 'KeyW,ShiftLeft', 'full: W + Shift (Player reads 1.0)' );
	ok( [ ...T.boatThrottleKeys( 0.7 ) ].join() === 'KeyW', 'ahead: W (0.7)' );
	ok( [ ...T.boatThrottleKeys( - 0.6 ) ].join() === 'KeyS', 'astern: S (-0.6)' );
	ok( T.boatThrottleKeys( 0 ).size === 0, 'stop: nothing' );
	ok( T.planeDragKeys( 0, - 40 ).has( 'KeyW' ) && T.planeDragKeys( 0, 40 ).has( 'KeyS' ) && T.planeDragKeys( - 40, 0 ).has( 'KeyA' ), 'seaplane drag: up nose down (W), down nose up (S), left bank (A)' );
	ok( T.planeDragKeys( 5, 5 ).size === 0, 'a small drag does nothing' );
	ok( T.planeThrottleKeys( 0.8, 0.2 ).has( 'ShiftLeft' ) && T.planeThrottleKeys( 0.1, 0.6 ).has( 'KeyC' ) && T.planeThrottleKeys( 0.5, 0.51 ).size === 0, 'seaplane slider: Shift up, C down, held until it is there' );

}

// ---- prompts and context buttons
{

	ok( T.promptAction( { key: 'E', text: 'Board boat' } ).code === 'KeyE', 'E prompt -> KeyE' );
	ok( T.promptAction( { key: 'Space', text: 'Climb ladder' } ).code === 'Space', 'Space prompt -> Space' );
	ok( T.promptAction( { key: 'LMB' } ).button === 'left' && T.promptAction( { key: 'RMB' } ).button === 'right', 'mouse prompts -> buttons' );
	ok( T.promptAction( { key: '$' } ) === null && T.promptAction( { key: '…' } ) === null && T.promptAction( null ) === null, 'information prompts are not actions' );
	let b = T.contextButtons( { mode: 'walk', prompt: { key: 'E', text: 'Talk' }, canFish: true } );
	ok( b.has( 'interact' ) && b.has( 'rod' ) && b.has( 'jump' ) && ! b.has( 'cast' ), 'on foot by the water: interact, rod, jump' );
	b = T.contextButtons( { mode: 'walk', rod: true, rodState: 'floating', canFish: true } );
	ok( b.has( 'cast' ) && b.has( 'reel' ) && b.has( 'rod' ), 'rod out, bobber floating: cast and reel in' );
	b = T.contextButtons( { mode: 'walk', rod: true, rodState: 'fighting', fight: true, canFish: true } );
	ok( b.has( 'cast' ) && ! b.has( 'rod' ), 'in a fight: the rod cannot be put away' );
	b = T.contextButtons( { mode: 'boat', guns: true, prompt: { key: 'E', text: 'Leave helm' } } );
	ok( b.has( 'throttle' ) && b.has( 'fireL' ) && b.has( 'fireR' ) && b.has( 'camera' ) && b.has( 'interact' ) && ! b.has( 'jump' ), 'at the helm with guns: lever, port / starboard, view, leave' );
	ok( ! T.contextButtons( { mode: 'boat' } ).has( 'fireL' ), 'no guns, no fire buttons' );
	b = T.contextButtons( { mode: 'walk', melee: true } );
	ok( b.has( 'dodge' ) && b.has( 'guard' ), 'a fight on foot: dodge and guard' );
	ok( ! T.contextButtons( { mode: 'walk', melee: true, rod: true } ).has( 'guard' ), 'rod out: no guard (the right button reels)' );
	b = T.contextButtons( { mode: 'swim' } );
	ok( b.has( 'jump' ) && b.has( 'dive' ), 'swimming: up and dive' );
	ok( T.contextButtons( { mode: 'plane' } ).has( 'planeThrottle' ), 'seaplane: the throttle lever' );
	// the light buttons (wave 9): L in a boat; N and ; in the seaplane; the state only lights them
	b = T.contextButtons( { mode: 'boat' } );
	ok( b.has( 'lights' ) && ! b.has( 'navLights' ) && ! b.has( 'landing' ), 'boat: a Lights button, no plane lights' );
	b = T.contextButtons( { mode: 'plane' } );
	ok( b.has( 'navLights' ) && b.has( 'landing' ) && ! b.has( 'lights' ), 'seaplane: Nav and Landing, no boat lights' );
	ok( T.contextButtons( { mode: 'boat', boatLights: true } ).has( 'lights' ) && T.contextButtons( { mode: 'plane', planeNav: true, planeLanding: true } ).has( 'navLights' ), 'the flags do not change which light buttons show' );
	ok( ! T.contextButtons( { mode: 'walk' } ).has( 'lights' ) && ! T.contextButtons( { mode: 'walk' } ).has( 'navLights' ) && ! T.contextButtons( { mode: 'swim' } ).has( 'landing' ), 'on foot: no light buttons' );
	ok( T.contextButtons( { mode: 'boat', busy: true } ).size === 0 && ! T.contextButtons( { mode: 'plane', freeCam: true } ).has( 'navLights' ), 'a panel open / free camera: no light buttons' );
	ok( T.buttonIsOn( 'lights', { boatLights: true } ) && ! T.buttonIsOn( 'lights', { boatLights: false } ) && ! T.buttonIsOn( 'lights', {} ), 'Lights is lit from boatLights' );
	ok( T.buttonIsOn( 'navLights', { planeNav: true } ) && ! T.buttonIsOn( 'navLights', { planeLanding: true } ) && T.buttonIsOn( 'landing', { planeLanding: true } ) && ! T.buttonIsOn( 'cast', { boatLights: true } ), 'Nav / Landing are lit from planeNav / planeLanding; other buttons never' );
	{

		// the snapshot reads the boat lights and the seaplane's systems (optional chaining: neither need exist)
		const tc = Object.create( TouchControls.prototype );
		tc._mode = () => 'plane';
		tc._busy = () => false;
		tc.app = { boatLightsOn: true, features: { get: ( n ) => ( n === 'seaplane' ? { systems: { nav: true, landing: false } } : null ) } };
		let snap = tc.snapshot( null );
		ok( snap.boatLights === true && snap.planeNav === true && snap.planeLanding === false, 'snapshot: boatLights, planeNav, planeLanding' );
		tc.app = {};
		snap = tc.snapshot( null );
		ok( snap.boatLights === false && snap.planeNav === false && snap.planeLanding === false, 'snapshot: all false without the app state' );

	}

	ok( T.contextButtons( { mode: 'boat', boardOffer: true } ).has( 'board' ), 'a boarding offer: Board' );
	ok( T.contextButtons( { mode: 'boat', helmAshore: true } ).has( 'deck' ) && ! T.contextButtons( { mode: 'boat' } ).has( 'deck' ), 'stopped by land: a Deck button (E steps ashore)' );
	ok( T.contextButtons( { mode: 'deck', choices: true } ).has( 'choice2' ), 'a surrender: the 1 / 2 choices' );
	ok( T.contextButtons( { mode: 'walk', busy: true, prompt: { key: 'E', text: 'x' } } ).size === 0, 'a panel is open: no game buttons' );
	b = T.contextButtons( { mode: 'free', freeCam: true, prompt: { key: 'F', text: 'Walk' } } );
	ok( b.has( 'interact' ) && b.size === 1, 'free camera: only the way back' );

}

// ---- Input: the touch source
{

	const input = new Input( { addEventListener: on( handlers.dom ) } );
	input.setTouchKeys( new Set( [ 'KeyW', 'ShiftLeft' ] ) );
	ok( input.down( 'KeyW' ) && input.hit( 'KeyW' ) && input.down( 'ShiftLeft' ), 'touch keys: held and a press edge' );
	input.endFrame();
	input.setTouchKeys( new Set( [ 'KeyW', 'ShiftLeft' ] ) );
	ok( input.down( 'KeyW' ) && ! input.hit( 'KeyW' ), 'still held: no second edge' );
	input.setTouchKeys( new Set( [ 'KeyW' ] ) );
	ok( ! input.down( 'ShiftLeft' ), 'a dropped code is released' );
	// a key the keyboard holds is not touched by the touch source's own releases
	fire( handlers.window, 'keydown', { code: 'KeyD' } );
	input.setTouchKeys( new Set( [ 'KeyW' ] ) );
	input.setTouchKeys( new Set() );
	ok( input.down( 'KeyD' ) && ! input.down( 'KeyW' ), 'touch releases only what it held' );
	fire( handlers.window, 'keyup', { code: 'KeyD' } );
	// something clears the keys under the stick (the menu): the next sync puts them back
	input.setTouchKeys( new Set( [ 'KeyA' ] ) );
	input.keys.clear();
	input.setTouchKeys( new Set( [ 'KeyA' ] ) );
	ok( input.down( 'KeyA' ), 'held touch keys come back after input.keys.clear()' );
	input.setTouchButton( 'left', true );
	ok( input.mouseDown, 'the cast button holds the left button' );
	input.setTouchButton( 'left', false );
	ok( ! input.mouseDown, 'and lets it go' );
	input.setTouchButton( 'right', true );
	ok( input.rightDown, 'guard / reel in hold the right button' );
	input.releaseTouch();
	ok( ! input.rightDown && ! input.down( 'KeyA' ), 'releaseTouch lets everything go' );
	input.sensitivity = 3;
	input.addTouchLook( 10, - 4 );
	const l = input.consumeLook();
	ok( l.x === 10 && l.y === - 4, 'touch look is not scaled by the mouse sensitivity' );
	// a tap's copied mouse events are ignored, and there is no pointer lock to ask for
	fire( handlers.window, 'touchstart', {} );
	fire( handlers.dom, 'mousedown', { button: 0 } );
	ok( ! input.mouseDown, 'a mousedown right after a touch is the browser\'s copy: ignored' );
	let asked = 0;
	input.dom.requestPointerLock = () => { asked ++; };
	input.touchMode = true;
	input.requestLock();
	ok( asked === 0, 'touch mode: requestLock asks for nothing' );
	input.setTouchKeys( new Set( [ 'KeyW' ] ) );
	fire( handlers.window, 'blur', {} );
	input.setTouchKeys( new Set( [ 'KeyW' ] ) );
	ok( input.down( 'KeyW' ), 'after a blur the stick still moves (held set resynced)' );

}

// ---- TouchControls' held keys without a DOM (the prototype's _sync on a bare object)
{

	const keys = { last: null };
	const fake = ( mode, extra = {} ) => {

		const o = Object.create( TouchControls.prototype );
		Object.assign( o, {
			input: { setTouchKeys: ( k ) => { keys.last = [ ...k ].sort().join(); } },
			app: { player: { mode }, game: {}, features: { get: () => extra.seaplane || null, panelOpen: () => false } },
			ui: {}, settings: { sensitivity: 1, invert: false }, _stick: null, _look: null, _throttle: 0, _planeThrottle: 0,
		}, extra );
		return o;

	};

	const stick = ( dx, dy ) => ( { v: T.stickVector( dx, dy, 54 ) } );
	let o = fake( 'walk', { _stick: stick( 0, - 70 ) } );
	o._sync();
	ok( keys.last === 'KeyW,ShiftLeft', 'on foot: the stick past the ring walks and sprints' );
	o = fake( 'boat', { _stick: stick( - 50, - 10 ), _throttle: 0.7 } );
	o._sync();
	ok( keys.last === 'KeyA,KeyW', 'at the helm: the stick steers, the lever (ahead) holds W' );
	o = fake( 'boat', { _stick: stick( 0, - 50 ), _throttle: 0 } );
	o._sync();
	ok( keys.last === 'KeyW', 'lever at stop: the stick pushed forward still goes' );
	o = fake( 'boat', { _stick: stick( 0, 50 ), _throttle: 1 } );
	o._sync();
	ok( keys.last === 'KeyW,ShiftLeft', 'lever at full: the stick does not fight it' );
	const seaplane = { flight: { controls: { throttle: 0.2 } } };
	o = fake( 'plane', { seaplane, _planeThrottle: 0.9, _look: { x: 100, y: 60, sx: 100, sy: 100 }, _stick: stick( 0, - 80 ) } );
	o._sync();
	ok( keys.last === 'KeyW,ShiftLeft', 'seaplane: drag up = nose down (W), the slider above the throttle holds Shift (the ring does not add a second)' );
	o = fake( 'plane', { seaplane, _planeThrottle: 0, _look: { x: 100, y: 140, sx: 100, sy: 100 } } );
	o._sync();
	ok( keys.last === 'KeyC,KeyS', 'seaplane: drag down = nose up (S), slider below: C' );
	o = fake( 'walk', { _stick: stick( 0, - 70 ) } );
	o.app.menuOpen = true;
	o._sync();
	ok( keys.last === '', 'a menu up: the touch controls hold nothing' );

}

// ---- Quality: the mobile path
{

	const app = { qs: new URLSearchParams( '' ), settings: {} };
	const phone = { mobile: true, phone: true, tablet: false };
	let q = new Quality( app, { storage: store(), device: phone } );
	ok( q.mobile === MOBILE.phone && q.tier === 'low' && q.probed && q.auto, 'a phone starts on Low, auto on, no probe at High' );
	ok( q.scale <= 0.75 && app.settings.renderScale <= 0.75, 'render scale at most 0.75 on a phone' );
	ok( q.loop.ceiling === 'medium', 'auto on a phone never climbs past Medium' );
	const st = q.settings;
	ok( st.shadowSize <= 1024 && st.shadowFar < TIERS.low.shadowFar && st.periods[ 2 ] >= 8, 'shadows: 1024 map, shorter reach, the far cascade rarely' );
	ok( st.particles < TIERS.low.particles && st.lights <= 6 && st.residents.animate < TIERS.low.residents.animate && st.fx === 'low', 'fewer particles, lamps and animated residents' );
	q.setTier( 'high' );
	ok( q.tier === 'high' && q.scale <= 0.75, 'High picked by hand on a phone: still capped at 0.75' );
	// the loop's range on the cap
	const loop = new QualityLoop( { tier: 'medium', scale: 0.85, maxScale: 0.75 } );
	ok( loop.scale === 0.75 && loop.range()[ 1 ] === 0.75 && loop.range( 'ultra' )[ 0 ] === 0.75, 'QualityLoop: maxScale caps every tier' );
	let ch = null;
	for ( let i = 0; i < 400 && ! ( ch && ch.tier === 'high' ); i ++ ) {

		const c = loop.frame( 8, 5 );
		if ( c ) ch = c;

	}

	ok( loop.scale <= 0.75, 'stepping up never passes the cap' );
	// a saved desktop choice is ignored on a phone; a mobile one is kept
	const s1 = store();
	s1.setItem( STORAGE_KEY, JSON.stringify( { tier: 'ultra', scale: 1, auto: false, target: 60, ceiling: 'ultra', probed: true } ) );
	q = new Quality( app, { storage: s1, device: phone } );
	ok( q.tier === 'low' && q.auto, 'a desktop-era saved choice is not reused on a phone' );
	q.setTier( 'medium' );
	q = new Quality( app, { storage: s1, device: phone } );
	ok( q.tier === 'medium' && JSON.parse( s1.getItem( STORAGE_KEY ) ).profile === 'mobile', 'a choice made on the phone is kept' );
	q = new Quality( app, { storage: store(), device: { mobile: true, tablet: true, appleSilicon: true } } );
	ok( q.tier === 'medium' && q.scale <= 0.85 && q.loop.ceiling === 'high', 'an M-series iPad starts on Medium (cap 0.85)' );
	q = new Quality( app, { storage: store(), device: { mobile: true, tablet: true } } );
	ok( q.tier === 'low', 'another tablet starts on Low' );
	q = new Quality( app, { storage: store(), device: { mobile: false } } );
	ok( q.mobile === null && ! q.probed && q.tier === 'high', 'a desktop keeps the probe at High' );
	ok( mobileTier( TIERS.high, null ) === TIERS.high && mobileProfile( { mobile: false } ) === null, 'no profile: the tier as it is' );
	q = new Quality( { qs: new URLSearchParams( 'quality=ultra' ), settings: {} }, { storage: store(), device: phone } );
	ok( q.tier === 'ultra' && ! q.auto && q.scale <= 0.75, '?quality=ultra still works on a phone (capped scale)' );

}

// ---- the fold (wave 10E): splitButtons and the FoldState machine, fake time
{

	const names = ( set ) => [ ...set ].sort().join( ',' );
	T.splitButtons.enabled = true; // (the fold is opt-in since 2026-10-13; these checks exercise the helper)
	const split = ( s ) => T.splitButtons( T.contextButtons( s ), s.mode, { fight: T.fightOn( s ) } );
	// the seaplane: only the interact button and the lever stay; camera, cockpit, nav, landing fold away
	let sp = split( { mode: 'plane', prompt: { key: 'E', text: 'Leave plane' } } );
	ok( names( sp.primary ) === 'interact,planeThrottle', 'seaplane: primary = interact + lever' );
	ok( [ ...sp.tray ].join( ',' ) === 'camera,cockpit,navLights,landing,bail', 'seaplane: tray = camera, cockpit, nav, landing, bail (in order)' );
	// on foot: Jump and Rod fold away, Cast / Reel / interact stay
	sp = split( { mode: 'walk', rod: true, rodState: 'floating', canFish: true, prompt: { key: 'E', text: 'Talk' } } );
	ok( sp.primary.has( 'cast' ) && sp.primary.has( 'reel' ) && sp.primary.has( 'interact' ) && ! sp.primary.has( 'jump' ), 'fishing: cast, reel, interact stay (fold enabled for these checks)' );
	ok( sp.tray.has( 'jump' ) && sp.tray.has( 'rod' ), 'fishing: jump and rod fold when the fold is enabled' );
	// the boat
	sp = split( { mode: 'boat', guns: true, helmAshore: true } );
	ok( sp.primary.has( 'throttle' ) && ! sp.primary.has( 'camera' ) && sp.tray.has( 'camera' ) && sp.tray.has( 'lights' ) && sp.tray.has( 'fireL' ) && sp.tray.has( 'fireR' ) && sp.tray.has( 'deck' ), 'boat: the lever stays, view / lights / port / starboard / deck fold' );
	// disjoint, and nothing lost outside a fight
	let all = true;
	for ( const mode of [ 'walk', 'swim', 'boat', 'plane', 'deck', 'ride', 'seat' ] ) for ( const extra of [ {}, { rod: true, rodState: 'floating', canFish: true }, { gunOwned: true }, { gunDrawn: true }, { guns: true, helmAshore: true }, { boardOffer: true, choices: true } ] ) {

		const st = { mode, ...extra }, full = T.contextButtons( st ), r = split( st );
		if ( r.primary.size + r.tray.size !== full.size ) all = false;
		for ( const id of r.tray ) if ( r.primary.has( id ) ) all = false;

	}

	ok( all, 'every mode: primary + tray = the full set, no button in both' );
	// a fight: Dodge / Guard come up as primary, the tray is empty (the handle hides)
	sp = split( { mode: 'walk', melee: true } );
	ok( sp.primary.has( 'dodge' ) && sp.primary.has( 'guard' ) && sp.tray.size === 0, 'melee: dodge + guard primary, no tray' );
	sp = split( { mode: 'deck', boardFight: true, boardOffer: true, melee: true, gunDrawn: true, gunOwned: true } );
	ok( sp.primary.has( 'board' ) && sp.primary.has( 'aim' ) && sp.primary.has( 'fire' ) && sp.tray.size === 0, 'boarding fight with a gun: board, fire, aim primary, no tray' );
	ok( T.fightOn( { boardFight: true } ) && T.fightOn( { melee: true } ) && ! T.fightOn( { fight: true } ) && ! T.fightOn( {} ), 'fightOn: melee or boarding only (a fish fight is not one)' );
	ok( T.splitButtons( null ).tray.size === 0 && T.splitButtons( new Set( [ 'jump' ] ), 'walk' ).tray.has( 'jump' ) && T.splitButtons( new Set( [ 'camera', 'planeThrottle' ] ), 'plane' ).tray.has( 'camera' ), 'splitButtons: a null set is empty, jump and the camera fold when enabled' );
	T.splitButtons.enabled = false;
	ok( T.splitButtons( new Set( [ 'jump' ] ), 'walk' ).primary.has( 'jump' ) && T.splitButtons( new Set( [ 'camera' ] ), 'plane' ).tray.size === 0, 'splitButtons: off by default (the game ships without the fold): nothing folds anywhere' );

	// the state machine, with a fake clock (ms)
	const F = T.FoldState;
	let f = new F( { idle: 5000, drag: 28, tap: 10 } );
	ok( ! f.open && ! f.hidden, 'starts closed' );
	f.down( 700, 0 );
	ok( f.up( 702, 80 ) === 'open' && f.open, 'a tap opens' );
	f.down( 700, 100 );
	ok( f.up( 699, 160 ) === 'close' && ! f.open, 'a second tap closes' );
	f.down( 700, 200 );
	ok( f.move( 690, 220 ) === null && ! f.open, 'a short upward move does nothing yet' );
	ok( f.move( 660, 240 ) === 'open' && f.open, 'an upward drag past the threshold opens' );
	ok( f.move( 600, 260 ) === null && f.up( 600, 280 ) === null && f.open, 'the drag fires once; letting go after it does not toggle' );
	f.down( 650, 300 );
	ok( f.move( 690, 320 ) === 'close' && ! f.open, 'a downward drag closes' );
	ok( f.move( 600, 330 ) === null && ! f.open, 'one gesture changes the state once' );
	f.up( 600, 360 );
	// the idle close
	f = new F( { idle: 5000 } );
	f.toggle( 1000 );
	ok( f.open && ! f.tick( 5999 ) && f.open, 'open: still open 4.999 s later' );
	ok( f.tick( 6000 ) && ! f.open, 'closes after 5 s without a press' );
	f.toggle( 10000 );
	f.press( 14000 );
	f.release( 14500 );
	ok( ! f.tick( 19000 ) && f.open && f.tick( 19500 ) && ! f.open, 'a press restarts the clock' );
	f.toggle( 20000 );
	f.press( 20100 ); // jump held
	ok( ! f.tick( 90000 ) && f.open, 'a held button (jump) keeps the tray open' );
	f.release( 91000 );
	ok( ! f.tick( 95000 ) && f.tick( 96000 ) && ! f.open, 'closes 5 s after the button is let go' );
	f.toggle( 100000 );
	f.down( 700, 102000 );
	ok( ! f.tick( 120000 ) && f.open, 'no idle close while the handle is being dragged' );
	f.cancel();
	// a fight hides the handle
	f = new F();
	f.toggle( 0 );
	f.setHidden( true, 10 );
	ok( f.hidden && ! f.open, 'a fight hides the handle and shuts the tray' );
	ok( f.down( 700, 20 ) === false && f.up( 700, 30 ) === null && ! f.open && f.toggle( 40 ) === false, 'hidden: taps and toggles do nothing' );
	f.setHidden( false, 50 );
	ok( ! f.hidden && ! f.open && f.down( 700, 60 ) === true, 'the fight ends: the handle is back, closed' );
	f.up( 700, 70 );
	ok( f.open, 'and works again' );
	// per-mode memory (this session only)
	f = new F();
	ok( f.setMode( 'walk', 0 ) && ! f.setMode( 'walk', 1 ), 'setMode reports a change once' );
	f.toggle( 10 );
	f.setMode( 'plane', 20 );
	ok( ! f.open, 'a new mode starts closed' );
	f.toggle( 30 );
	f.setMode( 'walk', 40 );
	ok( f.open, 'back in the first mode: it was left open' );
	f.setMode( 'plane', 50 );
	ok( f.open, 'the plane was left open too' );
	f.close();
	f.setMode( 'boat', 60 );
	f.setMode( 'plane', 70 );
	ok( ! f.open, 'closed in the plane: remembered closed' );
	// the top-right rail: toggle, 6 s idle, kept open while a panel is up
	const rail = new F( { idle: 6000 } );
	rail.toggle( 0 );
	ok( rail.open && ! rail.tick( 5999 ) && rail.tick( 6000 ) && ! rail.open, 'the rail toggle folds back after 6 s' );
	rail.toggle( 10000 );
	rail.keep( 15000 );
	ok( ! rail.tick( 20999 ) && rail.open && rail.tick( 21000 ), 'keep() (a panel is open) restarts the rail clock' );
	rail.toggle( 30000 );
	ok( rail.toggle( 31000 ) === false, 'a second tap on the toggle closes it' );

}

console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
