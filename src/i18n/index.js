// Localization for the UI text. English is the source language; Romanian is the first translation.
//
//   t( key, fallback, vars )   the text for a key in the current language
//                              lookup: current table -> `fallback` (the English written at the call site) -> English table -> the key
//                              vars: t( 'x', 'Slot {n}', { n: 2 } ) fills {n}; a table value may be an array [ one, other ]
//                              (Romanian [ one, few, other ]) picked by vars.n
//   tx( english )              translate a whole English string that is a value in a table (prompts, toasts and
//                              panels that other code builds in English); unknown strings come back unchanged.
//   getLang() / setLang( id )  the current language; setLang persists it ('alpha-astra.lang') and calls the listeners
//   onLang( fn )               fn( id ) on every change; returns the unsubscribe function
//   translateDom( root )       rewrite the text, tooltips and aria labels under root that are table values (in any
//                              language, so switching back and forth works)
//   observeDom( root )         translateDom for nodes added to root later (use on panels, not on per-frame HUD text)
//
// Keys are stable ids ('menu.resume'); never build a key from translated text. Add new strings to en.js and ro.js;
// a missing Romanian entry shows the English text, so nothing breaks while a table is incomplete.
import en from './en.js';
import ro from './ro.js';

export const STORAGE_KEY = 'alpha-astra.lang';
export const LANGS = [
	{ id: 'en', name: 'English', table: en },
	{ id: 'ro', name: 'Română', table: ro },
];
const TABLES = Object.fromEntries( LANGS.map( ( l ) => [ l.id, l.table ] ) );

let lang = 'en';
const listeners = new Set();

function readStored() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage.getItem( STORAGE_KEY ) : null;

	} catch ( e ) {

		return null;

	}

}

// the languages the settings offer (user, 2026-10-15: "I want the game in english, as it is"). The game always starts in
// English: neither the browser's language nor a saved choice from before switches it (ro.js stays on disk, unused; setLang
// still works for tests and tools). Add an id here to offer a language again; the settings' picker appears with two or more.
export const OFFERED = [ 'en' ];

// English, whatever the browser says or an earlier session saved (readStored is kept for when a choice is offered again)
function detect() {

	const saved = readStored();
	return saved && OFFERED.includes( saved ) && TABLES[ saved ] ? saved : 'en';

}

lang = detect();

export function getLang() {

	return lang;

}

export function hasLang( id ) {

	return !! TABLES[ id ];

}

export function setLang( id, { persist = true } = {} ) {

	if ( ! TABLES[ id ] ) return false;
	const changed = id !== lang;
	lang = id;
	if ( persist ) {

		try {

			if ( typeof localStorage !== 'undefined' ) localStorage.setItem( STORAGE_KEY, id );

		} catch ( e ) { /* no storage: the choice lasts for this session */ }

	}

	if ( changed ) {

		if ( typeof document !== 'undefined' && document.documentElement ) document.documentElement.lang = id;
		for ( const fn of [ ...listeners ] ) {

			try { fn( id ); } catch ( e ) { console.warn( 'i18n listener failed', e ); }

		}

	}

	return true;

}

export function onLang( fn ) {

	listeners.add( fn );
	return () => listeners.delete( fn );

}

// plural category index for a count: English one / other; Romanian one / few (0 and 2..19, x02..x19) / other
export function pluralIndex( id, n ) {

	n = Math.abs( Math.floor( Number( n ) || 0 ) );
	if ( id === 'ro' ) return n === 1 ? 0 : ( n === 0 || ( n % 100 > 0 && n % 100 < 20 ) ) ? 1 : 2;
	return n === 1 ? 0 : 1;

}

function fill( s, vars ) {

	if ( ! vars ) return s;
	return s.replace( /\{(\w+)\}/g, ( m, k ) => ( vars[ k ] !== undefined && vars[ k ] !== null ? String( vars[ k ] ) : m ) );

}

function pick( v, vars ) {

	if ( Array.isArray( v ) ) return v[ Math.min( pluralIndex( lang, vars && vars.n ), v.length - 1 ) ];
	return v;

}

export function t( key, fallback, vars ) {

	let v = TABLES[ lang ] ? TABLES[ lang ][ key ] : undefined;
	if ( v === undefined ) v = fallback;
	if ( v === undefined ) v = en[ key ];
	if ( v === undefined ) v = key;
	return fill( String( pick( v, vars ) ), vars );

}

// ---- translating whole strings (value -> key)

let reverse = null;

// every table's text -> its key, so a string built in any language can be turned into the current one
function reverseIndex() {

	if ( reverse ) return reverse;
	reverse = new Map();
	for ( const l of LANGS ) for ( const [ k, v ] of Object.entries( l.table ) ) if ( typeof v === 'string' && ! reverse.has( v ) ) reverse.set( v, k );
	return reverse;

}

export function tx( text ) {

	if ( lang === 'en' || typeof text !== 'string' ) return text;
	const key = reverseIndex().get( text );
	return key ? t( key, text ) : text;

}

// ---- the DOM translator (stateless: a text that is a value of some key becomes that key's text in the current language)

const TEXT_ATTRS = [ 'data-tip', 'aria-label', 'title', 'placeholder' ];

function swapString( src ) {

	const trimmed = src.trim();
	if ( ! trimmed ) return null;
	const key = reverseIndex().get( trimmed );
	if ( ! key ) return null;
	const out = t( key, trimmed );
	return out === trimmed ? null : src.replace( trimmed, () => out );

}

function swapText( node ) {

	const out = swapString( node.nodeValue );
	if ( out !== null ) node.nodeValue = out;

}

function swapAttrs( el ) {

	for ( const a of TEXT_ATTRS ) {

		const now = el.getAttribute( a );
		if ( now === null ) continue;
		const out = swapString( now );
		if ( out !== null ) el.setAttribute( a, out );

	}

}

export function translateDom( root ) {

	if ( typeof document === 'undefined' || ! root ) return 0;
	let n = 0;
	const walk = ( node ) => {

		if ( node.nodeType === 3 ) {

			swapText( node );
			n ++;
			return;

		}

		if ( node.nodeType !== 1 ) return;
		const tag = node.tagName;
		if ( tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT' ) return;
		swapAttrs( node );
		for ( let c = node.firstChild; c; c = c.nextSibling ) walk( c );

	};

	walk( root );
	return n;

}

const observed = new Map(); // root -> observer

// translate nodes added under root from now on (and root itself once); a no-op while the language is English
export function observeDom( root ) {

	if ( typeof MutationObserver === 'undefined' || ! root || observed.has( root ) ) return;
	let queued = new Set();
	let frame = 0;
	const flush = () => {

		frame = 0;
		const nodes = queued;
		queued = new Set();
		if ( lang === 'en' ) return;
		for ( const node of nodes ) if ( node.isConnected ) translateDom( node );

	};

	const obs = new MutationObserver( ( list ) => {

		if ( lang === 'en' ) return;
		for ( const m of list ) for ( const node of m.addedNodes ) queued.add( node.nodeType === 3 ? node.parentNode || node : node );
		if ( queued.size && ! frame ) frame = requestAnimationFrame( flush );

	} );
	obs.observe( root, { childList: true, subtree: true } );
	observed.set( root, obs );
	// a language change re-translates the whole subtree
	onLang( () => translateDom( root ) );
	translateDom( root );

}
