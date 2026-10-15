// Plain-node test of accessibility, key remapping and localization (no DOM, no GPU): the translation tables (parity,
// placeholders, the call sites' fallbacks), the language switch, the options and their persistence, the key binding model,
// core/Input.js behind a stub window, prompts and gamepad bindings.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- a stub browser: window / document just enough for Input and for i18n's storage
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};

const handlers = { window: {}, dom: {}, document: {} };
const on = ( bag ) => ( type, fn ) => ( bag[ type ] ||= [] ).push( fn );
globalThis.window = { addEventListener: on( handlers.window ) };
globalThis.document = { addEventListener: on( handlers.document ), pointerLockElement: null, documentElement: {} };
globalThis.localStorage = store();
const fire = ( bag, type, ev ) => { for ( const fn of bag[ type ] || [] ) fn( { preventDefault() {}, target: {}, repeat: false, ...ev } ); };

const { default: en } = await import( '../src/i18n/en.js' );
const { default: ro } = await import( '../src/i18n/ro.js' );
const i18n = await import( '../src/i18n/index.js' );
const { t, tx, setLang, getLang, onLang, pluralIndex, LANGS } = i18n;
const { Input } = await import( '../src/core/Input.js' );
const A = await import( '../src/ui/Accessibility.js' );

// ---- the tables
{

	const enKeys = Object.keys( en ), roKeys = Object.keys( ro );
	ok( enKeys.length > 300, `English table has ${ enKeys.length } keys` );
	ok( roKeys.every( ( k ) => k in en ), 'Romanian has no key that English lacks' );
	const vars = ( s ) => ( String( s ).match( /\{\w+\}/g ) || [] ).sort().join();
	ok( enKeys.filter( ( k ) => k in ro ).every( ( k ) => vars( en[ k ] ) === vars( ro[ k ] ) ), 'placeholders agree where both languages have the key' );
	const byEn = new Map();
	let clash = 0;
	for ( const k of enKeys.filter( ( k ) => k in ro ) ) {

		if ( byEn.has( en[ k ] ) && byEn.get( en[ k ] ) !== ro[ k ] ) clash ++;
		byEn.set( en[ k ], ro[ k ] );

	}

	ok( clash === 0, 'one English text never has two Romanian translations (the DOM translator looks text up by value)' );
	ok( enKeys.every( ( k ) => ! /[ăâîșțĂÂÎȘȚ]/.test( en[ k ] ) ), 'English text is plain' );
	ok( roKeys.some( ( k ) => /[ăâîșț]/.test( ro[ k ] ) ), 'Romanian uses the comma-below letters' );
	ok( ! roKeys.some( ( k ) => /[şţ]/.test( ro[ k ] ) ), 'no cedilla forms (ş ţ) in Romanian' );

	// every t( 'key', 'English' ) in the files I own matches the English table, and every key it names exists
	let calls = 0, bad = [];
	for ( const f of [ 'src/ui/Accessibility.js', 'src/ui/AppUI.js', 'src/ui/PauseMenu.js' ] ) {

		const src = readFileSync( new URL( `../${ f }`, import.meta.url ), 'utf8' );
		const re = /\bt\(\s*'([\w.]+)'\s*,\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
		let m;
		while ( ( m = re.exec( src ) ) ) {

			calls ++;
			const fb = m[ 2 ].slice( 1, - 1 ).replace( /\\'/g, "'" );
			if ( ! ( m[ 1 ] in en ) ) bad.push( `${ f }: missing ${ m[ 1 ] }` );
			else if ( en[ m[ 1 ] ] !== fb ) bad.push( `${ f }: ${ m[ 1 ] } says "${ fb }" but en.js says "${ en[ m[ 1 ] ] }"` );

		}

	}

	ok( calls > 200, `${ calls } t() calls scanned` );
	ok( bad.length === 0, `call-site fallbacks match en.js ${ bad.slice( 0, 3 ).join( ' | ' ) }` );
	// the dynamic keys: one per action, group, key name
	const dyn = [];
	for ( const a of A.ACTIONS ) { dyn.push( `act.${ a.id }` ); if ( a.tip ) dyn.push( `act.${ a.id }.tip` ); }
	for ( const g of A.GROUPS ) dyn.push( `grp.${ g.id }` );
	ok( dyn.every( ( k ) => k in en ), `every action, tip and group has a key ${ dyn.filter( ( k ) => ! ( k in en ) ).join() }` );
	const named = A.ACTIONS.every( ( a ) => en[ `act.${ a.id }` ] === a.name ) && A.GROUPS.every( ( g ) => en[ `grp.${ g.id }` ] === g.name );
	ok( named, 'English names of the actions and groups equal the table' );

}

// ---- t / tx / setLang / plurals
{

	ok( getLang() === 'en', 'English by default (no browser language stub)' );
	ok( t( 'pause.resume', 'x' ) === 'Resume', 'a table entry beats the fallback' );
	ok( t( 'nope.key', 'Fallback' ) === 'Fallback' && t( 'nope.key' ) === 'nope.key', 'unknown key: fallback, then the key' );
	ok( t( 'pause.slot', '', { n: 3 } ) === 'slot 3', 'placeholders are filled' );
	let seen = [];
	const off = onLang( ( id ) => seen.push( id ) );
	ok( setLang( 'ro' ) && getLang() === 'ro' && seen[ 0 ] === 'ro', 'setLang switches and notifies' );
	ok( localStorage.getItem( i18n.STORAGE_KEY ) === 'ro', 'the language is persisted' );
	ok( t( 'pause.resume', 'Resume' ) === 'Reia' && t( 'pause.slot', '', { n: 2 } ) === 'slotul 2', 'Romanian lookups' );
	ok( t( 'nope.key', 'Fallback' ) === 'Fallback', 'a key with no entry still shows the call site text' );
	ok( tx( 'Strike now!' ) === 'Trage acum!' && tx( 'Never heard of it' ) === 'Never heard of it', 'tx translates whole strings and leaves the rest' );
	ok( tx( 'Trage acum!' ) === 'Trage acum!', 'tx of a Romanian string stays' );
	ok( ! setLang( 'xx' ) && getLang() === 'ro', 'an unknown language is refused' );
	ok( pluralIndex( 'ro', 1 ) === 0 && pluralIndex( 'ro', 0 ) === 1 && pluralIndex( 'ro', 2 ) === 1 && pluralIndex( 'ro', 19 ) === 1 && pluralIndex( 'ro', 20 ) === 2 && pluralIndex( 'ro', 101 ) === 1 && pluralIndex( 'ro', 120 ) === 2, 'Romanian plural categories (one, few, other)' );
	ok( pluralIndex( 'en', 1 ) === 0 && pluralIndex( 'en', 2 ) === 1 && pluralIndex( 'en', 0 ) === 1, 'English plural categories' );
	ok( LANGS.length === 2 && LANGS[ 1 ].name === 'Română', 'language list' );
	setLang( 'en' );
	ok( t( 'pause.resume', 'Resume' ) === 'Resume' && seen.at( - 1 ) === 'en', 'back to English' );
	off();

}

// ---- the options
const mk = ( storage = store(), input = null ) => new A.Accessibility( { app: input ? { input, settings: {}, game: { state: { career: {} } } } : null, input, storage, doc: null } );
{

	const a = mk();
	ok( a.get( 'fishingAssist' ) === false && a.tensionRate() === 1, 'the fishing assist is off by default' );
	ok( a.get( 'uiScale' ) === 1 && a.get( 'subtitles' ) === true && a.get( 'colorBlind' ) === 'off' && a.get( 'reelMode' ) === 'hold' && a.get( 'sprintMode' ) === 'hold', 'defaults' );
	ok( A.coerce( 'uiScale', 9 ) === 1.6 && A.coerce( 'uiScale', 0 ) === 0.8 && A.coerce( 'uiScale', 'x' ) === 1, 'numbers clamp, junk falls back' );
	ok( A.coerce( 'colorBlind', 'purple' ) === 'off' && A.coerce( 'invertY', 'yes' ) === false && A.coerce( 'unknown', 1 ) === undefined, 'enum / bool / unknown' );
	a.set( 'fishingAssist', true );
	a.set( 'uiScale', 1.25 );
	a.set( 'colorBlind', 'redgreen' );
	ok( a.tensionRate() === A.ASSIST_RATE && A.ASSIST_RATE < 1, 'the assist slows the tension' );
	a.save();
	const raw = JSON.parse( a.storage.getItem( A.STORAGE_KEY ) );
	ok( raw.fishingAssist === true && raw.uiScale === 1.25, 'options are written to storage' );
	const b = new A.Accessibility( { storage: a.storage, doc: null } );
	ok( b.get( 'fishingAssist' ) === true && b.get( 'uiScale' ) === 1.25 && b.get( 'colorBlind' ) === 'redgreen', 'options come back after a reload' );
	const junk = store();
	junk.setItem( A.STORAGE_KEY, '{"uiScale":"huge","bindings":{"interact":"Escape","jump":"KeyJ"},"colorBlind":3}' );
	const c = new A.Accessibility( { storage: junk, doc: null } );
	ok( c.get( 'uiScale' ) === 1 && c.get( 'colorBlind' ) === 'off', 'corrupt options are repaired' );
	ok( ! ( 'interact' in c.bindings ) && c.bindings.jump === 'KeyJ', 'a saved binding to a reserved key is dropped' );
	const d = new A.Accessibility( { storage: { getItem: () => '{not json', setItem() { throw new Error( 'full' ); } }, doc: null } );
	ok( d.get( 'uiScale' ) === 1 && d.save() === false, 'bad JSON and a full storage do not throw' );
	a.resetOptions();
	ok( a.get( 'fishingAssist' ) === false && a.get( 'uiScale' ) === 1, 'reset puts the options back' );
	ok( a.subtitle( 'Hello' ) === false, 'captions need a document' );

}

// ---- options reach the input and the game
{

	const input = new Input( { addEventListener: on( handlers.dom ) } );
	const a = mk( store(), input );
	a.set( 'sensitivity', 2 );
	a.set( 'invertY', true );
	fire( handlers.window, 'mousemove', { movementX: 3, movementY: 4 } ); // not locked: ignored
	input.locked = true;
	fire( handlers.window, 'mousemove', { movementX: 3, movementY: 4 } );
	const look = input.consumeLook();
	ok( look.x === 6 && look.y === - 8, 'mouse sensitivity scales and invert Y flips the look' );
	a.set( 'reduceMotion', true );
	ok( a.app.settings.reduceMotion === true, 'reduce motion reaches app.settings' );
	a.set( 'cameraShake', 0.4 );
	ok( a.app.settings.cameraShake === 0.4, 'camera shake reaches app.settings' );
	a.set( 'fishingAssist', true );
	ok( a.app.settings.fishingAssist === true, 'the assist reaches app.settings' );
	input.locked = false;

}

// ---- key binding model
{

	const a = mk();
	ok( a.binding( 'interact' ) === 'KeyE' && a.label( 'interact' ) === 'E', 'Interact starts on E' );
	ok( a.label( 'dive' ) === 'C' && a.label( 'sprint' ) === 'Shift / Right Shift', 'aliases show until a key is rebound (the dive has no Ctrl alias any more)' );
	let r = a.rebind( 'interact', 'KeyG' );
	ok( r.ok && a.binding( 'interact' ) === 'KeyG' && a.isChanged( 'interact' ), 'Interact moves to G' );
	ok( a.bindingTable().KeyE === 'KeyG', 'the table maps logical E to physical G' );
	r = a.rebind( 'rod', 'KeyG' );
	ok( ! r.ok && r.conflict === 'interact', 'a taken key reports the conflict' );
	ok( a.binding( 'rod' ) === 'KeyR', 'the refused rebind changed nothing' );
	r = a.rebind( 'rod', 'KeyG', { swap: true } );
	ok( r.ok && a.binding( 'rod' ) === 'KeyG' && a.binding( 'interact' ) === 'KeyR', 'swap trades the two keys' );
	ok( a.conflicts().size === 0, 'no shared keys after a swap' );
	ok( ! a.rebind( 'rod', 'Escape' ).ok && a.rebind( 'rod', 'Escape' ).reason === 'reserved', 'Escape is reserved' );
	ok( ! a.rebind( 'rod', 'KeyH' ).ok && ! a.rebind( 'rod', 'F1' ).ok, 'H and F1 are reserved too' );
	ok( a.rebind( 'nope', 'KeyJ' ).reason === 'unknown', 'unknown action' );
	a.rebind( 'dive', 'KeyN' );
	ok( a.label( 'dive' ) === 'N' && a.keysOf( 'dive' ).length === 1, 'a rebound action drops its aliases' );
	a.unbind( 'light' );
	ok( a.binding( 'light' ) === '' && a.label( 'light' ) === 'Unbound' && a.bindingTable().KeyL === null, 'an action can be unbound' );
	a.resetAction( 'light' );
	ok( a.binding( 'light' ) === 'KeyL', 'one action resets' );
	ok( ! a.rebind( 'mute', 'KeyW' ).ok && ! ( 'mute' in a.bindings ), 'a key in use is refused without a swap' );
	// a save can still hold a shared key (written by hand or by an older version): the Controls tab flags it
	const shared = store();
	shared.setItem( A.STORAGE_KEY, JSON.stringify( { bindings: { mute: 'KeyW' } } ) );
	const sh = new A.Accessibility( { storage: shared, doc: null } );
	ok( sh.conflicts().get( 'KeyW' ).includes( 'forward' ) && sh.conflicts().get( 'KeyW' ).includes( 'mute' ), 'a shared key is reported' );
	a.resetBindings();
	ok( Object.keys( a.bindings ).length === 0 && Object.keys( a.bindingTable() ).length === 0, 'reset puts every key back' );
	a.rebind( 'interact', 'KeyG' );
	a.save();
	const b = new A.Accessibility( { storage: a.storage, doc: null } );
	ok( b.binding( 'interact' ) === 'KeyG', 'bindings persist' );
	ok( a.registerAction( { id: 'map', code: 'KeyN', name: 'World map' } ) && ! a.registerAction( { id: 'map', code: 'KeyN' } ), 'a feature registers its own key once' );
	ok( a.noteKey( 'KeyU', 'seaplane' ) && a.action( 'feature.seaplane.KeyU' ).name === 'Seaplane key' && ! a.noteKey( 'KeyU', 'seaplane' ), 'claimKey of an unlisted key becomes a row' );
	ok( a.action( 'map' ).group === 'more', 'feature keys land in Other' );
	ok( a.usedBy( 'KeyN' ).includes( 'map' ), 'usedBy sees the new key' );

}

// ---- core/Input.js behind the table
{

	const input = new Input( { addEventListener: on( handlers.dom ) } );
	const press = ( code, extra = {} ) => fire( handlers.window, 'keydown', { code, ...extra } );
	const release = ( code ) => fire( handlers.window, 'keyup', { code } );
	const frame = () => input.endFrame();

	press( 'KeyE' );
	ok( input.hit( 'KeyE' ) && input.down( 'KeyE' ), 'unmapped: E is E' );
	release( 'KeyE' );
	frame();
	input.setBindings( { KeyE: 'KeyG' } );
	press( 'KeyG' );
	ok( input.hit( 'KeyE' ), 'G triggers the logical E' );
	release( 'KeyG' );
	frame();
	press( 'KeyE' );
	ok( ! input.hit( 'KeyE' ) && ! input.down( 'KeyE' ), 'the old key no longer triggers E' );
	release( 'KeyE' );
	frame();
	ok( input.physicalFor( 'KeyE' ) === 'KeyG' && input.physicalFor( 'KeyR' ) === 'KeyR', 'physicalFor' );
	// a swap: R on G and E on R
	input.setBindings( { KeyE: 'KeyR', KeyR: 'KeyE' } );
	press( 'KeyR' );
	ok( input.hit( 'KeyE' ) && ! input.hit( 'KeyR' ), 'swapped: R is E' );
	release( 'KeyR' );
	frame();
	press( 'KeyE' );
	ok( input.hit( 'KeyR' ) && ! input.hit( 'KeyE' ), 'swapped: E is R' );
	release( 'KeyE' );
	frame();
	input.setBindings( { KeyL: null } );
	press( 'KeyL' );
	ok( ! input.hit( 'KeyL' ), 'an unbound action never fires' );
	release( 'KeyL' );
	frame();
	let prevented = 0;
	input.setBindings( { KeyE: 'KeyG' } );
	fire( handlers.window, 'keydown', { code: 'KeyG', preventDefault() { prevented ++; } } );
	ok( prevented === 1, 'a bound key is kept from the page' );
	release( 'KeyG' );
	frame();
	input.setBindings( {} );

	// sprint as a toggle
	input.setToggle( [ 'ShiftLeft' ], true );
	press( 'KeyW' );
	press( 'ShiftLeft' );
	release( 'ShiftLeft' );
	frame();
	ok( input.down( 'ShiftLeft' ), 'toggle: sprint stays on after the key is let go' );
	press( 'ShiftLeft' );
	release( 'ShiftLeft' );
	frame();
	ok( ! input.down( 'ShiftLeft' ), 'toggle: the next press switches it off' );
	press( 'ShiftLeft' );
	release( 'ShiftLeft' );
	frame();
	release( 'KeyW' );
	frame();
	ok( ! input.down( 'ShiftLeft' ), 'toggle: sprint stops when you stop moving' );
	input.setToggle( [ 'ShiftLeft' ], false );
	press( 'ShiftLeft' );
	ok( input.down( 'ShiftLeft' ), 'hold mode again: down while pressed' );
	release( 'ShiftLeft' );
	ok( ! input.down( 'ShiftLeft' ), 'hold mode: up when released' );

	// the reel as a toggle
	let fish = false;
	input.reelActive = () => fish;
	input.reelToggle = true;
	fire( handlers.dom, 'mousedown', { button: 0 } );
	fire( handlers.window, 'mouseup', { button: 0 } );
	ok( ! input.mouseDown, 'no fish: the button is just the button' );
	fire( handlers.dom, 'mousedown', { button: 0 } ); // the strike: the fish is not on yet
	fish = true; // ... and now it is, with the button still down
	ok( ! input.mouseDown, 'the strike click starts the fight with the reel off' );
	fire( handlers.window, 'mouseup', { button: 0 } );
	fire( handlers.dom, 'mousedown', { button: 0 } );
	fire( handlers.window, 'mouseup', { button: 0 } );
	ok( input.mouseDown, 'toggle: a click starts the reel and it stays on' );
	fire( handlers.dom, 'mousedown', { button: 0 } );
	fire( handlers.window, 'mouseup', { button: 0 } );
	ok( ! input.mouseDown, 'toggle: the next click stops it' );
	input.reelToggle = false;
	fire( handlers.dom, 'mousedown', { button: 0 } );
	ok( input.mouseDown, 'hold mode: down while held' );
	fire( handlers.window, 'mouseup', { button: 0 } );
	ok( ! input.mouseDown, 'hold mode: up when let go' );
	input.mouseDown = true;
	ok( input.mouseDown, 'the gamepad sets the button through the setter' );
	input.mouseDown = false;

	// gamepad buttons
	ok( input.padButton( 'KeyE', 2 ) === 2, 'pad: the default button' );
	input.setPadBindings( { KeyE: 7 } );
	ok( input.padButton( 'KeyE', 2 ) === 7 && input.padButton( 'KeyR', 3 ) === 3, 'pad: a remapped button' );

}

// ---- wave 5: keys that fight the browser
{

	const dom = { addEventListener: on( handlers.dom ) };
	const input = new Input( dom );
	// (every Input made in this file listens on the stub window: count "was it prevented at all")
	const kd = ( code, extra = {} ) => { let n = 0; fire( handlers.window, 'keydown', { code, preventDefault() { n ++; }, ...extra } ); return n > 0; };
	const ku = ( code ) => fire( handlers.window, 'keyup', { code } );
	const saves = [];
	input.onShortcut = ( n ) => saves.push( n );
	ok( kd( 'KeyS', { ctrlKey: true } ) && saves.join() === 'save', 'Ctrl+S is kept from the page (no save dialog) and asks for the quick save' );
	ok( ! input.down( 'KeyS' ) && ! input.hit( 'KeyS' ), 'Ctrl+S does not walk the player backwards' );
	ku( 'KeyS' );
	input.endFrame();
	ok( kd( 'KeyS', { metaKey: true } ) && saves.length === 2, 'Cmd+S as well' );
	ok( [ 'KeyP', 'KeyD', 'KeyO', 'KeyU', 'KeyF', 'KeyG', 'KeyH' ].every( ( c ) => kd( c, { ctrlKey: true } ) ) && saves.length === 2, 'Ctrl + P D O U F G H are kept from the page (and save nothing)' );
	ok( ! kd( 'KeyI', { ctrlKey: true, shiftKey: true } ) && ! kd( 'KeyJ', { ctrlKey: true, shiftKey: true } ) && ! kd( 'KeyC', { ctrlKey: true, shiftKey: true } ), 'Ctrl+Shift+I / J / C (devtools) are left alone' );
	ok( ! kd( 'KeyW', { ctrlKey: true } ) && ! input.down( 'KeyW' ), 'Ctrl+W is no move (and without the keyboard lock a page cannot stop it)' );
	ok( ! kd( 'ControlLeft', { ctrlKey: true } ) && ! input.down( 'ControlLeft' ), 'Ctrl itself is no game key' );
	kd( 'KeyS', { ctrlKey: true, altKey: true } );
	ok( input.down( 'KeyS' ) && saves.length === 2, 'AltGr (Ctrl + Alt) still types a game key' );
	ku( 'KeyS' );
	ok( ! kd( 'KeyS', { ctrlKey: true, target: { tagName: 'INPUT' } } ) && saves.length === 2, 'in a text field Ctrl+S stays the browser\'s' );
	ok( kd( 'F1' ) && kd( 'F3' ), 'plain F1 / F3 are kept while the game has the focus' );
	ok( ! kd( 'F5' ), 'F5 still reloads while the mouse is free' );
	input.locked = true;
	ok( kd( 'F5' ) && ! kd( 'F5', { shiftKey: true } ), 'F5 is kept while the mouse is captured; Shift+F5 reloads' );
	input.locked = false;
	ok( A.RESERVED.has( 'ControlLeft' ) && A.RESERVED.has( 'ControlRight' ), 'Ctrl cannot be bound to an action' );
	const st = store();
	st.setItem( A.STORAGE_KEY, JSON.stringify( { bindings: { dive: 'ControlLeft' } } ) );
	ok( mk( st ).binding( 'dive' ) === 'KeyC', 'an old saved Ctrl binding is dropped (the action goes back to its key)' );
	ok( A.ACTIONS.every( ( x ) => ! ( x.also || [] ).some( ( k ) => /^Control/.test( k ) ) && ! /^Control/.test( x.code ) ), 'no action answers to Ctrl' );

	// fullscreen: the page through the API, and the keyboard lock while it lasts
	let asked = 0, unlocks = 0;
	const locks = [];
	document.documentElement.requestFullscreen = () => { asked ++; document.fullscreenElement = document.documentElement; return Promise.resolve(); };
	document.exitFullscreen = () => { document.fullscreenElement = null; return Promise.resolve(); };
	const nav = Object.getOwnPropertyDescriptor( globalThis, 'navigator' );
	Object.defineProperty( globalThis, 'navigator', { value: { keyboard: { lock: ( k ) => { locks.push( k ); return Promise.resolve(); }, unlock: () => { unlocks ++; } } }, configurable: true, writable: true } );
	ok( kd( 'F11' ) && asked >= 1, 'F11 asks for fullscreen' ); // (each stub Input toggles: settle the state by hand)
	document.fullscreenElement = document.documentElement;
	fire( handlers.document, 'fullscreenchange', {} );
	const lk = locks[ 0 ] || [];
	ok( input.keyboardLocked && input.fullscreen && lk.includes( 'KeyW' ) && lk.includes( 'KeyT' ) && lk.includes( 'KeyN' ), 'fullscreen locks the keyboard: Ctrl+W / T / N reach the game' );
	ok( ! lk.includes( 'Escape' ) && ! lk.includes( 'KeyI' ) && ! lk.includes( 'KeyJ' ) && ! lk.includes( 'F12' ), 'Escape and the devtools keys stay the browser\'s' );
	ok( kd( 'KeyW', { ctrlKey: true } ) && ! input.down( 'KeyW' ), 'locked: Ctrl+W is kept from the browser' );
	input.toggleFullscreen();
	fire( handlers.document, 'fullscreenchange', {} );
	ok( ! input.keyboardLocked && unlocks >= 1 && ! input.fullscreen, 'leaving fullscreen unlocks the keyboard' );
	if ( nav ) Object.defineProperty( globalThis, 'navigator', nav );
	else delete globalThis.navigator;

	// the buttons never stick
	fire( handlers.dom, 'mousedown', { button: 2 } );
	ok( input.rightDown, 'RMB down' );
	fire( handlers.window, 'mousemove', { buttons: 0, movementX: 0, movementY: 0 } );
	ok( ! input.rightDown, 'a mouseup lost to a context menu: mousemove\'s buttons let it go' );
	fire( handlers.dom, 'mousedown', { button: 2 } );
	fire( handlers.dom, 'mousedown', { button: 0 } );
	document.pointerLockElement = dom;
	fire( handlers.document, 'pointerlockchange', {} );
	ok( input.locked && input.rightDown && input.mouseDown, 'captured with both buttons down' );
	const r0 = input.releases;
	document.pointerLockElement = null;
	fire( handlers.document, 'pointerlockchange', {} );
	ok( ! input.locked && ! input.rightDown && ! input.mouseDown && input.releases === r0 + 1, 'the lock lost: both buttons are let go and releases counts it' );
	fire( handlers.dom, 'mousedown', { button: 2 } );
	fire( handlers.window, 'blur', {} );
	ok( ! input.rightDown && input.releases === r0 + 2, 'a window blur lets go too' );
	input.rightDown = true;
	ok( input.rightDown, 'the gamepad trigger still drives the right button through the setter' );
	fire( handlers.window, 'mousemove', { buttons: 0, movementX: 0, movementY: 0 } );
	ok( input.rightDown, 'and the mouse resync does not drop the trigger' );
	input.rightDown = false;

	// the guard option, and Ctrl+S through the accessibility layer
	const toasts = [];
	let saved = 0, flushed = 0;
	const app = { input, settings: {}, game: { state: { career: {} } }, session: true, menuOpen: false, saveNow: () => { saved ++; return true; }, universe: { flush: ( u ) => { if ( u ) flushed ++; } } };
	input.onShortcut = null;
	const ax = new A.Accessibility( { app, ui: { toast: ( t ) => toasts.push( t ) }, input, storage: store(), doc: null } );
	ok( ax.get( 'guardMode' ) === 'hold' && input.guardToggle === false, 'the guard is a hold by default' );
	ax.set( 'guardMode', 'toggle' );
	ok( input.guardToggle === true && app.settings.guardMode === 'toggle', 'the toggle guard reaches the input and the settings' );
	ax.set( 'guardMode', 'nonsense' );
	ok( ax.get( 'guardMode' ) === 'hold', 'a bad guard mode falls back to hold' );
	kd( 'KeyS', { ctrlKey: true } );
	ok( saved === 1 && flushed === 1 && toasts.includes( 'Game saved' ), 'Ctrl+S saves the slot, sends a universe snapshot at once and says so' );
	app.menuOpen = true;
	kd( 'KeyS', { ctrlKey: true } );
	ok( saved === 1, 'not on the main menu' );
	app.menuOpen = false;
	app.saveNow = () => false;
	ok( ax.quickSave() === false && toasts.includes( 'Could not save' ), 'a blocked storage is reported' );
	input.onShortcut = null;

}

// ---- gamepad model
{

	const a = mk();
	ok( a.padButton( 'interact' ) === 2 && a.padButton( 'nope' ) === - 1, 'pad defaults' );
	ok( a.rebindPad( 'interact', 6 ).reason === 'reserved' && a.rebindPad( 'interact', 9 ).reason === 'reserved', 'triggers, Back and Start are reserved' );
	ok( a.rebindPad( 'interact', 0 ).conflict === 'jump', 'a taken button reports the conflict' );
	const r = a.rebindPad( 'interact', 0, { swap: true } );
	ok( r.ok && a.padButton( 'interact' ) === 0 && a.padButton( 'jump' ) === 2, 'pad swap' );
	ok( a.padTable().KeyE === 0 && a.padTable().Space === 2, 'the pad table maps logical codes to buttons' );
	a.resetPad();
	ok( Object.keys( a.padTable() ).length === 0, 'pad reset' );
	ok( A.padLabel( 0 ) === 'A' && A.padLabel( 30 ) === 'Button 30', 'pad names' );

}

// ---- prompts and key names
{

	const a = mk();
	ok( a.prompt( { key: 'E', text: 'Board boat' } ).key === 'E', 'prompts keep the default key' );
	a.rebind( 'interact', 'KeyG' );
	a.rebind( 'rod', 'KeyU' );
	const p = a.prompt( { key: 'E', text: 'Leave helm   ·   V  camera' } );
	ok( p.key === 'G' && p.text === 'Leave helm   ·   V  camera', 'the key hint follows the binding' );
	const q = a.prompt( { key: 'LMB', text: 'Hold to wind up, release to cast   ·   R  put the rod away' } );
	ok( q.key === 'LMB' && q.text.includes( '·   U  put' ), 'a key named inside the text follows the binding too' );
	a.set( 'reelMode', 'toggle' );
	ok( /^Click to reel/.test( a.prompt( { key: 'LMB', text: 'Hold to reel · let go when the tension goes red' } ).text ), 'toggle reel changes the hint' );
	ok( a.prompt( { key: 'LMB', text: 'Strike now!' } ).text === 'Strike now!', 'other prompts are untouched' );
	ok( a.prompt( { key: 'E', text: 'Talk to Ethena Prosper' } ).text === 'Talk to Ethena Prosper', 'talk prompts keep the name' );
	setLang( 'ro' );
	ok( a.prompt( { key: 'E', text: 'Talk to Ethena Prosper' } ).text === 'Vorbește cu Ethena Prosper', 'the talk prompt is translated with its name' );
	ok( a.prompt( { key: 'E', text: 'Leave helm   ·   V  camera' }, tx ).text === 'Lasă cârma   ·   V  cameră', 'a whole prompt is translated, the key letter stays' );
	ok( a.prompt( { key: 'LMB', text: 'Hold to reel · let go when the tension goes red' }, tx ).text.startsWith( 'Click pentru a mulineta' ), 'toggle hint in Romanian' );
	ok( A.keyLabel( 'Space' ) === 'Spațiu' && A.keyLabel( 'KeyQ' ) === 'Q' && A.keyLabel( 'Digit4' ) === '4' && A.keyLabel( 'ArrowUp' ) === '↑', 'key names follow the language' );
	setLang( 'en' );
	ok( A.keyLabel( 'Space' ) === 'Space' && A.keyLabel( 'F7' ) === 'F7' && A.keyLabel( '' ) === 'Unbound', 'English key names' );
	const layout = { get: ( c ) => ( { KeyW: 'z', KeyQ: 'a' } )[ c ] };
	ok( A.keyLabel( 'KeyW', layout ) === 'Z' && A.keyLabel( 'KeyE', layout ) === 'E', 'a keyboard layout map renames the letters (AZERTY)' );

}

if ( fails ) {

	console.log( `${ fails } FAILED` );
	process.exit( 1 );

}

console.log( 'all passed' );
