// Plain-node test of wave 20D (the interface for waves 13-19 on desktop and touch), no browser, no GPU:
//   - a layout audit: the real panels (Ethena's Crew tab with the wave 19 crew lives, the roster, the tavern's Hands and Menu
//     tabs, the navy office and the press gang, Roid's yard, PoorGoat's stand, the cooler, the new guide pages, the long
//     toasts) are built by their own code, parsed, styled by a small CSS cascade fed with the game's real CSS (ui/ui.css and
//     the panels' own CSS strings, read from the source files) and laid out with Inter-like text metrics at 1280x720,
//     1920x1080, 390x844 and 844x390 (the last two as a touch phone). The game is English only (user, 2026-10-15), so
//     the audit is English. Checks: nothing wider than its box, every panel fits the screen or scrolls, tap targets >= 44 px
//     on touch, long toasts read whole.
//   - i18n: the game starts in English whatever the browser or an old save says; no language picker while one is offered;
//     the call-site fallbacks of HudPanels.js / GameHUD.js / TouchControls.js match en.js where a key is there.
//   - touch: the contextual hail answer (Heave to / Run) and the shot button at the helm; the key glyphs on touch.
//   - the guide's new pages and the one-time tips (crew lives, the navy, storm fronts, interiors).
//
//   node test/feature-ui-w20.mjs                       the test
//   node test/feature-ui-w20.mjs --shots=<dir>         also draws every audited panel to <dir>/<panel>-<size>-<lang>.png
//                                                      (the layout model's boxes and text over a game capture, issues in
//                                                      red; System.Drawing through PowerShell)
//   node test/feature-ui-w20.mjs --report              prints every issue found (the audit's raw list)
//
// The DOM HUD is not in the WebGPU canvas, so tools/visuals/capture.mjs cannot show it: this model is the capture.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const read = ( p ) => readFileSync( join( ROOT, p ), 'utf8' );
const arg = ( k, d = null ) => {

	const a = process.argv.find( ( x ) => x.startsWith( '--' + k + '=' ) );
	return a ? a.slice( k.length + 3 ) : process.argv.includes( '--' + k ) ? true : d;

};

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};
globalThis.localStorage = store();

// =============================================================================================== text metrics
// Helvetica's advance widths (1/1000 em, ASCII 32..126), scaled to Inter (a little wider); mono: 0.6 em a character
const AFM = [ 278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
	556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
	667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
	278, 278, 278, 469, 556, 333,
	556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
	334, 260, 334, 584 ];
const FOLD = { 'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't', 'Ă': 'A', 'Â': 'A', 'Î': 'I', 'Ș': 'S', 'Ț': 'T', '’': '\'', '‘': '\'' };
const EXTRA = { '·': 278, '×': 584, '★': 900, '—': 1000, '–': 556, '…': 1000, '“': 333, '”': 333, '●': 600, '○': 600, '„': 333 };
const INTER = 1.08;

function charW( c ) {

	if ( FOLD[ c ] ) c = FOLD[ c ];
	if ( EXTRA[ c ] ) return EXTRA[ c ];
	const k = c.charCodeAt( 0 );
	return k >= 32 && k <= 126 ? AFM[ k - 32 ] : 600;

}

export function textWidth( s, f ) {

	if ( ! s ) return 0;
	if ( f.upper ) s = s.toUpperCase();
	if ( f.mono ) return s.length * 0.6 * f.size + ( f.ls || 0 ) * s.length;
	let w = 0;
	for ( const c of s ) w += charW( c );
	return w / 1000 * f.size * INTER * ( f.weight >= 600 ? 1.04 : 1 ) + ( f.ls || 0 ) * s.length;

}

// =============================================================================================== HTML
const VOID = new Set( [ 'img', 'br', 'input', 'hr', 'meta', 'link', 'source', 'wbr' ] );
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', times: '×', middot: '·', hellip: '…' };
const decode = ( s ) => s.replace( /&(#x?[0-9a-f]+|\w+);/gi, ( m, e ) => e[ 0 ] === '#' ? String.fromCodePoint( e[ 1 ] === 'x' || e[ 1 ] === 'X' ? parseInt( e.slice( 2 ), 16 ) : Number( e.slice( 1 ) ) ) : ENT[ e ] ?? m );

export function mkEl( tag, attrs = {}, parent = null ) {

	const el = { tag, attrs, classes: new Set( String( attrs.class || '' ).split( /\s+/ ).filter( Boolean ) ), children: [], parent };
	if ( parent ) parent.children.push( el );
	return el;

}

export function parseHTML( html, parent ) {

	let cur = parent;
	const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
	let m;
	while ( ( m = re.exec( html ) ) ) {

		if ( m[ 1 ] ) {

			const tag = m[ 1 ].toLowerCase();
			let p = cur;
			while ( p && p !== parent && p.tag !== tag ) p = p.parent;
			if ( p && p !== parent ) cur = p.parent;

		} else if ( m[ 2 ] ) {

			const attrs = {};
			const ar = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
			let a;
			while ( ( a = ar.exec( m[ 3 ] || '' ) ) ) attrs[ a[ 1 ].toLowerCase() ] = decode( a[ 2 ] ?? a[ 3 ] ?? a[ 4 ] ?? '' );
			const el = mkEl( m[ 2 ].toLowerCase(), attrs, cur );
			if ( ! VOID.has( el.tag ) && ! m[ 4 ] ) cur = el;

		} else if ( m[ 5 ] || m[ 6 ] ) cur.children.push( { text: decode( m[ 5 ] || m[ 6 ] ), parent: cur } );

	}

	return parent;

}

// =============================================================================================== CSS: values
const splitTop = ( s, sep ) => {

	const out = [];
	let d = 0, q = null, start = 0;
	for ( let i = 0; i < s.length; i ++ ) {

		const c = s[ i ];
		if ( q ) { if ( c === q ) q = null; continue; }
		if ( c === '"' || c === '\'' ) q = c;
		else if ( c === '(' || c === '[' ) d ++;
		else if ( c === ')' || c === ']' ) d --;
		else if ( d === 0 && s.startsWith( sep, i ) ) { out.push( s.slice( start, i ) ); start = i + sep.length; i += sep.length - 1; }

	}

	out.push( s.slice( start ) );
	return out.map( ( x ) => x.trim() ).filter( ( x ) => x !== '' );

};

// var( --x, fallback ) and env( ..., fallback ) substituted
function subst( v, vars, depth = 0 ) {

	if ( typeof v !== 'string' || depth > 24 ) return v;
	let i = v.search( /\b(var|env)\(/ );
	if ( i < 0 ) return v;
	const fn = v.startsWith( 'env(', i ) ? 'env' : 'var';
	let d = 0, j = i + fn.length;
	for ( ; j < v.length; j ++ ) {

		if ( v[ j ] === '(' ) d ++;
		else if ( v[ j ] === ')' && -- d === 0 ) break;

	}

	const inner = v.slice( i + fn.length + 1, j );
	const [ name, ...fb ] = splitTop( inner, ',' );
	const fall = fb.length ? fb.join( ', ' ) : '';
	const val = fn === 'env' ? ( fall || '0px' ) : ( vars[ name ] !== undefined ? vars[ name ] : fall );
	return subst( v.slice( 0, i ) + val + v.slice( j + 1 ), vars, depth + 1 );

}

// a length in px: calc / min / max / clamp, px em rem % vw vh dvh svh lvh vmin vmax (ctx: { fs, W, H, pct })
export function evalLen( v, ctx ) {

	if ( v === undefined || v === null ) return null;
	v = String( v ).trim();
	if ( ! v || v === 'auto' || v === 'none' || v === 'normal' || v === 'max-content' || v === 'min-content' || v === 'fit-content' ) return null;
	const toks = [];
	const re = /\s*(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)([a-z%]*)|\s*([a-z-]+)\(|\s*([-+*/(),])/gy;
	let m, last = null;
	while ( re.lastIndex < v.length && ( m = re.exec( v ) ) ) {

		if ( m[ 1 ] !== undefined ) {

			// '-' glued to a number after a value is a minus, not a sign
			if ( m[ 1 ][ 0 ] === '-' && last && ( last.t === 'n' || last.t === ')' ) ) { toks.push( { t: 'op', v: '-' } ); toks.push( { t: 'n', v: Number( m[ 1 ].slice( 1 ) ), u: m[ 2 ] } ); }
			else toks.push( { t: 'n', v: Number( m[ 1 ] ), u: m[ 2 ] } );

		} else if ( m[ 3 ] ) toks.push( { t: 'f', v: m[ 3 ] } );
		else if ( m[ 4 ] === '(' || m[ 4 ] === ')' || m[ 4 ] === ',' ) toks.push( { t: m[ 4 ] } );
		else toks.push( { t: 'op', v: m[ 4 ] } );
		last = toks[ toks.length - 1 ];

	}

	if ( re.lastIndex < v.length && v.slice( re.lastIndex ).trim() ) return null;
	let p = 0;
	const unit = ( n, u ) => {

		switch ( u ) {

			case '': case 'px': return n;
			case 'em': return n * ctx.fs;
			case 'rem': return n * 16;
			case '%': return ctx.pct === undefined || ctx.pct === null ? NaN : n / 100 * ctx.pct;
			case 'vw': return n / 100 * ctx.W;
			case 'vh': case 'dvh': case 'svh': case 'lvh': return n / 100 * ctx.H;
			case 'vmin': return n / 100 * Math.min( ctx.W, ctx.H );
			case 'vmax': return n / 100 * Math.max( ctx.W, ctx.H );
			case 'deg': case 's': case 'ms': return NaN;
			default: return NaN;

		}

	};

	const expr = () => {

		let a = term();
		while ( toks[ p ] && toks[ p ].t === 'op' && ( toks[ p ].v === '+' || toks[ p ].v === '-' ) ) { const o = toks[ p ++ ].v; const b = term(); a = o === '+' ? a + b : a - b; }
		return a;

	};

	const term = () => {

		let a = factor();
		while ( toks[ p ] && toks[ p ].t === 'op' && ( toks[ p ].v === '*' || toks[ p ].v === '/' ) ) { const o = toks[ p ++ ].v; const b = factor(); a = o === '*' ? a * b : a / b; }
		return a;

	};

	const factor = () => {

		const k = toks[ p ++ ];
		if ( ! k ) return NaN;
		if ( k.t === 'n' ) return unit( k.v, k.u );
		if ( k.t === 'op' && k.v === '-' ) return - factor();
		if ( k.t === '(' ) { const a = expr(); p ++; return a; }
		if ( k.t === 'f' ) {

			const args = [];
			while ( toks[ p ] && toks[ p ].t !== ')' ) { args.push( expr() ); if ( toks[ p ] && toks[ p ].t === ',' ) p ++; }
			p ++;
			if ( k.v === 'calc' ) return args[ 0 ];
			if ( k.v === 'min' ) return Math.min( ...args );
			if ( k.v === 'max' ) return Math.max( ...args );
			if ( k.v === 'clamp' ) return Math.max( args[ 0 ], Math.min( args[ 1 ], args[ 2 ] ) );
			return NaN;

		}

		return NaN;

	};

	const r = expr();
	return Number.isFinite( r ) ? r : null;

}

// colours: #rgb #rrggbb rgb() rgba(), the first colour of a gradient
const NAMED = { transparent: [ 0, 0, 0, 0 ], white: [ 255, 255, 255, 1 ], black: [ 0, 0, 0, 1 ], none: [ 0, 0, 0, 0 ] };
export function parseColor( v ) {

	if ( ! v ) return null;
	v = String( v );
	const hex = /#([0-9a-f]{3,8})\b/i.exec( v );
	const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec( v );
	const at = ( x ) => ( x ? x.index : Infinity );
	if ( rgb && at( rgb ) <= at( hex ) ) return [ + rgb[ 1 ], + rgb[ 2 ], + rgb[ 3 ], rgb[ 4 ] === undefined ? 1 : + rgb[ 4 ] ];
	if ( hex ) {

		let h = hex[ 1 ];
		if ( h.length <= 4 ) h = [ ...h ].map( ( c ) => c + c ).join( '' );
		return [ parseInt( h.slice( 0, 2 ), 16 ), parseInt( h.slice( 2, 4 ), 16 ), parseInt( h.slice( 4, 6 ), 16 ), h.length >= 8 ? parseInt( h.slice( 6, 8 ), 16 ) / 255 : 1 ];

	}

	const w = v.trim().split( /\s+/ )[ 0 ];
	return NAMED[ w ] || null;

}

// =============================================================================================== CSS: rules
let ORDER = 0;
export function parseCSS( text, origin = 1 ) {

	text = text.replace( /\/\*[\s\S]*?\*\//g, '' );
	const rules = [];
	const block = ( s, media ) => {

		let i = 0;
		while ( i < s.length ) {

			const open = s.indexOf( '{', i );
			if ( open < 0 ) break;
			const head = s.slice( i, open ).replace( /^[\s};]+/, '' ).trim();
			let d = 1, j = open + 1;
			for ( ; j < s.length && d; j ++ ) { if ( s[ j ] === '{' ) d ++; else if ( s[ j ] === '}' ) d --; }
			const body = s.slice( open + 1, j - 1 );
			if ( head.startsWith( '@media' ) ) block( body, media ? `${ media } and ${ head.slice( 6 ).trim() }` : head.slice( 6 ).trim() );
			else if ( ! head.startsWith( '@' ) && head ) {

				const decls = [];
				for ( const d2 of splitTop( body, ';' ) ) {

					const c = d2.indexOf( ':' );
					if ( c < 0 ) continue;
					let val = d2.slice( c + 1 ).trim();
					const important = /!important\s*$/.test( val );
					if ( important ) val = val.replace( /\s*!important\s*$/, '' );
					decls.push( { prop: d2.slice( 0, c ).trim().toLowerCase(), val, important } );

				}

				rules.push( { sels: splitTop( head, ',' ).map( parseSelector ).filter( Boolean ), decls, media, origin, order: ORDER ++ } );

			}

			i = j;

		}

	};

	block( text, null );
	return rules;

}

function mediaOK( q, V ) {

	if ( ! q ) return true;
	return q.split( ',' ).some( ( part ) => part.split( /\band\b/ ).every( ( c ) => {

		c = c.trim();
		if ( ! c || c === 'screen' || c === 'all' || c === 'only screen' ) return true;
		const m = /^\(\s*([\w-]+)\s*(?::\s*([^)]+))?\)$/.exec( c );
		if ( ! m ) return false;
		const k = m[ 1 ], val = ( m[ 2 ] || '' ).trim();
		const px = parseFloat( val );
		switch ( k ) {

			case 'max-width': return V.W <= px;
			case 'min-width': return V.W >= px;
			case 'max-height': return V.H <= px;
			case 'min-height': return V.H >= px;
			case 'orientation': return val === ( V.W >= V.H ? 'landscape' : 'portrait' );
			case 'pointer': case 'any-pointer': return val === ( V.touch ? 'coarse' : 'fine' );
			case 'hover': case 'any-hover': return val === ( V.touch ? 'none' : 'hover' );
			default: return false;

		}

	} ) );

}

// a selector: right-to-left compounds with their combinator to the left
function parseSelector( sel ) {

	if ( /[+~]/.test( sel.replace( /\([^)]*\)|\[[^\]]*\]/g, '' ) ) ) return null; // (sibling combinators: never needed here)
	const parts = [];
	let cur = '', d = 0, comb = ' ';
	const push = () => { if ( cur.trim() ) parts.push( { c: parseCompound( cur.trim() ), comb } ); cur = ''; };
	for ( let i = 0; i < sel.length; i ++ ) {

		const ch = sel[ i ];
		if ( ch === '(' || ch === '[' ) d ++;
		if ( ch === ')' || ch === ']' ) d --;
		if ( d === 0 && ( ch === ' ' || ch === '>' ) ) {

			if ( cur.trim() ) { push(); comb = ' '; }
			if ( ch === '>' ) comb = '>';
			continue;

		}

		cur += ch;

	}

	push();
	if ( ! parts.length ) return null;
	let spec = 0;
	for ( const p of parts ) spec += p.c.spec;
	return { parts, spec };

}

function parseCompound( s ) {

	const c = { tag: null, cls: [], attrs: [], pseudo: [], spec: 0, never: false };
	const re = /^([a-zA-Z*][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([^\]]+)\]|(::?)([\w-]+)(\((?:[^()]|\([^()]*\))*\))?/g;
	let m;
	while ( ( m = re.exec( s ) ) ) {

		if ( m[ 1 ] ) { if ( m[ 1 ] !== '*' ) { c.tag = m[ 1 ].toLowerCase(); c.spec += 1; } }
		else if ( m[ 2 ] ) { c.cls.push( m[ 2 ] ); c.spec += 10; }
		else if ( m[ 3 ] ) { c.never = true; }
		else if ( m[ 4 ] ) {

			const a = /^\s*([\w-]+)\s*(?:([*^$|~]?=)\s*["']?([^"']*)["']?)?\s*$/.exec( m[ 4 ] );
			if ( a ) c.attrs.push( { k: a[ 1 ].toLowerCase(), op: a[ 2 ] || null, v: a[ 3 ] } );
			c.spec += 10;

		} else if ( m[ 5 ] === '::' ) { c.never = true; c.spec += 1; }
		else {

			const name = m[ 6 ], argv = m[ 7 ] ? m[ 7 ].slice( 1, - 1 ) : null;
			if ( name === 'not' ) { const inner = splitTop( argv, ',' ).map( parseCompound ); c.pseudo.push( { not: inner } ); c.spec += Math.max( ...inner.map( ( x ) => x.spec ) ); }
			else if ( name === 'disabled' ) { c.attrs.push( { k: 'disabled', op: null } ); c.spec += 10; }
			else if ( name === 'root' ) { c.tag = 'html'; c.spec += 10; }
			else if ( name === 'first-child' || name === 'last-child' ) { c.pseudo.push( { pos: name } ); c.spec += 10; }
			else if ( name === 'scope' ) { /* (a querySelector scope: matches) */ }
			else { c.never = true; c.spec += 10; } // :hover :active :focus :has ... states we do not model

		}

	}

	return c;

}

function matchCompound( el, c ) {

	if ( c.never || ! el || el.text !== undefined ) return false;
	if ( c.tag && el.tag !== c.tag ) return false;
	for ( const k of c.cls ) if ( ! el.classes.has( k ) ) return false;
	for ( const a of c.attrs ) {

		const v = el.attrs[ a.k ];
		if ( v === undefined ) return false;
		if ( a.op === '=' && v !== a.v ) return false;

	}

	for ( const p of c.pseudo ) {

		if ( p.not && p.not.some( ( x ) => matchCompound( el, x ) ) ) return false;
		if ( p.pos ) {

			const sib = el.parent ? el.parent.children.filter( ( x ) => x.tag ) : [ el ];
			if ( p.pos === 'first-child' && sib[ 0 ] !== el ) return false;
			if ( p.pos === 'last-child' && sib[ sib.length - 1 ] !== el ) return false;

		}

	}

	return true;

}

function matchSel( el, parts, i = parts.length - 1 ) {

	if ( ! matchCompound( el, parts[ i ].c ) ) return false;
	if ( i === 0 ) return true;
	const comb = parts[ i ].comb;
	if ( comb === '>' ) return matchSel( el.parent, parts, i - 1 );
	for ( let p = el.parent; p; p = p.parent ) if ( matchSel( p, parts, i - 1 ) ) return true;
	return false;

}

// the user agent's defaults the panels lean on
const UA = parseCSS( `
html { font-size: 16px; line-height: normal; }
div, p, h1, h2, h3, h4, section, ul, ol, li, header, footer, form, nav { display: block; }
h2 { font-size: 1.5em; font-weight: 700; margin: 0.83em 0; }
h3 { font-size: 1.17em; font-weight: 700; margin: 1em 0; }
p { margin: 1em 0; }
ul { margin: 1em 0; padding-left: 40px; }
b, strong { font-weight: 700; }
small { font-size: 0.83em; }
button { display: inline-block; font-size: 13.333px; font-weight: 400; padding: 1px 6px; border: 2px solid; text-align: center; }
kbd { font-family: monospace; }
img, input { display: inline-block; }
br { display: inline; }
`, 0 );

// =============================================================================================== cascade
const INHERIT = [ 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-transform', 'white-space', 'color', 'text-align', 'visibility' ];

function sidesOf( v, ctx ) {

	const p = splitTop( v, ' ' ).map( ( x ) => evalLen( x, ctx ) ?? 0 );
	const [ t, r = t, b = t, l = r ] = p;
	return [ t, r, b, l ];

}

export function computeStyles( root, rules, V ) {

	const live = rules.filter( ( r ) => mediaOK( r.media, V ) );
	const walk = ( el, parent ) => {

		if ( el.text !== undefined ) return;
		const hits = [];
		for ( const r of live ) for ( const s of r.sels ) if ( matchSel( el, s.parts ) ) { hits.push( { r, spec: s.spec } ); break; }
		const decl = [];
		for ( const h of hits ) for ( const d of h.r.decls ) decl.push( { ...d, spec: h.spec, origin: h.r.origin, order: h.r.order } );
		if ( el.attrs.style ) for ( const d2 of splitTop( el.attrs.style, ';' ) ) {

			const c = d2.indexOf( ':' );
			if ( c > 0 ) decl.push( { prop: d2.slice( 0, c ).trim().toLowerCase(), val: d2.slice( c + 1 ).trim().replace( /\s*!important\s*$/, '' ), important: /!important/.test( d2 ), spec: 1000, origin: 2, order: 1e9 } );

		}

		decl.sort( ( a, b ) => ( a.important - b.important ) || ( a.origin - b.origin ) || ( a.spec - b.spec ) || ( a.order - b.order ) );
		const P = {};
		for ( const d of decl ) P[ d.prop ] = d.val;
		// custom properties inherit; the rest of INHERIT too
		const vars = { ...( parent ? parent.cs.vars : {} ) };
		for ( const k of Object.keys( P ) ) if ( k.startsWith( '--' ) ) vars[ k ] = P[ k ];
		for ( const k of Object.keys( vars ) ) vars[ k ] = subst( vars[ k ], vars );
		const raw = {};
		for ( const k of Object.keys( P ) ) if ( ! k.startsWith( '--' ) ) raw[ k ] = subst( P[ k ], vars );
		el.cs = resolveStyle( el, raw, parent ? parent.cs : null, vars, V );
		for ( const c of el.children ) walk( c, el );

	};

	walk( root, null );

}

function resolveStyle( el, R, pcs, vars, V ) {

	const cs = { vars, raw: R };
	const inh = ( k, d ) => ( R[ k ] !== undefined && R[ k ] !== 'inherit' ? R[ k ] : pcs ? pcs[ '_' + k ] : d );
	// font shorthand
	let fontSize = R[ 'font-size' ], fontWeight = R[ 'font-weight' ], fontFamily = R[ 'font-family' ];
	if ( R.font ) {

		const t = splitTop( R.font, ' ' );
		let i = 0;
		while ( i < t.length && /^(normal|italic|oblique|small-caps|\d{3}|bold|bolder|lighter)$/.test( t[ i ] ) ) { if ( /^\d{3}$|bold/.test( t[ i ] ) ) fontWeight = t[ i ] === 'bold' ? '700' : t[ i ]; i ++; }
		if ( t[ i ] ) { fontSize = t[ i ].split( '/' )[ 0 ]; i ++; }
		fontFamily = t.slice( i ).join( ' ' ) || fontFamily;
		if ( fontWeight === undefined ) fontWeight = '400';

	}

	const pfs = pcs ? pcs.fs : 16;
	let fs = pfs;
	if ( fontSize !== undefined && fontSize !== 'inherit' ) fs = fontSize === 'smaller' ? pfs * 0.833 : fontSize === 'larger' ? pfs * 1.2 : evalLen( fontSize, { fs: pfs, W: V.W, H: V.H, pct: pfs } ) ?? pfs;
	cs.fs = fs;
	const w = fontWeight !== undefined && fontWeight !== 'inherit' ? fontWeight : pcs ? String( pcs.weight ) : '400';
	cs.weight = w === 'bold' ? 700 : w === 'normal' ? 400 : Number( w ) || 400;
	cs._family = fontFamily !== undefined && fontFamily !== 'inherit' ? fontFamily : pcs ? pcs._family : 'sans-serif';
	cs.mono = /mono|monospace|consolas|menlo/i.test( cs._family.split( ',' )[ 0 ] );
	const ctx = { fs, W: V.W, H: V.H };
	const lh = inh( 'line-height', 'normal' );
	cs[ '_line-height' ] = lh;
	cs.lh = lh === 'normal' ? fs * 1.21 : /^[\d.]+$/.test( String( lh ) ) ? Number( lh ) * fs : evalLen( lh, ctx ) ?? fs * 1.21;
	const ls = inh( 'letter-spacing', 'normal' );
	cs[ '_letter-spacing' ] = ls;
	cs.ls = ls === 'normal' ? 0 : evalLen( ls, ctx ) ?? 0;
	cs[ '_text-transform' ] = inh( 'text-transform', 'none' );
	cs.upper = cs[ '_text-transform' ] === 'uppercase';
	cs[ '_white-space' ] = inh( 'white-space', 'normal' );
	cs.nowrap = cs[ '_white-space' ] === 'nowrap' || cs[ '_white-space' ] === 'pre';
	cs[ '_color' ] = inh( 'color', '#eef6f8' );
	cs.color = parseColor( cs[ '_color' ] ) || [ 238, 246, 248, 1 ];
	cs[ '_text-align' ] = inh( 'text-align', 'left' );
	cs.align = cs[ '_text-align' ];
	cs[ '_visibility' ] = inh( 'visibility', 'visible' );
	// box
	let disp = R.display;
	if ( disp === undefined ) disp = 'inline';
	if ( el.attrs.hidden !== undefined && el.tag !== 'html' ) disp = 'none';
	cs.display = disp;
	cs.position = R.position || 'static';
	const pad = R.padding ? sidesOf( R.padding, ctx ) : [ 0, 0, 0, 0 ];
	for ( const [ i, s ] of [ 'top', 'right', 'bottom', 'left' ].entries() ) if ( R[ 'padding-' + s ] ) pad[ i ] = evalLen( R[ 'padding-' + s ], ctx ) ?? 0;
	if ( R[ 'padding-block' ] ) { const p = sidesOf( R[ 'padding-block' ], ctx ); pad[ 0 ] = p[ 0 ]; pad[ 2 ] = p[ 2 ] ?? p[ 0 ]; }
	cs.pad = pad;
	const mar = R.margin ? sidesOf( R.margin.replace( /\bauto\b/g, '0' ), ctx ) : [ 0, 0, 0, 0 ];
	for ( const [ i, s ] of [ 'top', 'right', 'bottom', 'left' ].entries() ) if ( R[ 'margin-' + s ] ) mar[ i ] = evalLen( R[ 'margin-' + s ], ctx ) ?? 0;
	cs.mar = mar;
	let bw = 0;
	const bm = /(\d+(?:\.\d+)?)px/.exec( R.border || '' );
	if ( R.border && R.border !== '0' && R.border !== 'none' ) bw = bm ? Number( bm[ 1 ] ) : ( /solid/.test( R.border ) ? 2 : 0 );
	if ( R[ 'border-width' ] ) bw = evalLen( R[ 'border-width' ], ctx ) ?? bw;
	cs.border = bw;
	cs.width = R.width; cs.minW = R[ 'min-width' ]; cs.maxW = R[ 'max-width' ];
	cs.height = R.height; cs.minH = R[ 'min-height' ]; cs.maxH = R[ 'max-height' ];
	cs.top = R.top; cs.left = R.left; cs.right = R.right; cs.bottom = R.bottom; cs.transform = R.transform || '';
	const gap = R.gap ? splitTop( R.gap, ' ' ).map( ( x ) => evalLen( x, ctx ) ?? 0 ) : [ 0 ];
	cs.rowGap = R[ 'row-gap' ] ? evalLen( R[ 'row-gap' ], ctx ) ?? 0 : gap[ 0 ];
	cs.colGap = R[ 'column-gap' ] ? evalLen( R[ 'column-gap' ], ctx ) ?? 0 : gap[ 1 ] ?? gap[ 0 ];
	cs.flexDir = R[ 'flex-direction' ] || 'row';
	cs.flexWrap = R[ 'flex-wrap' ] || 'nowrap';
	let grow = 0, shrink = 1, basis = 'auto';
	if ( R.flex ) {

		const f = R.flex.trim().split( /\s+/ );
		if ( f[ 0 ] === 'none' ) { grow = 0; shrink = 0; }
		else if ( f[ 0 ] === 'auto' ) { grow = 1; shrink = 1; }
		else if ( /^[\d.]+$/.test( f[ 0 ] ) ) { grow = Number( f[ 0 ] ); shrink = f[ 1 ] && /^[\d.]+$/.test( f[ 1 ] ) ? Number( f[ 1 ] ) : 1; basis = f.length === 1 ? '0px' : f[ f.length - 1 ] && ! /^[\d.]+$/.test( f[ f.length - 1 ] ) ? f[ f.length - 1 ] : '0px'; }

	}

	if ( R[ 'flex-grow' ] ) grow = Number( R[ 'flex-grow' ] );
	if ( R[ 'flex-shrink' ] ) shrink = Number( R[ 'flex-shrink' ] );
	if ( R[ 'flex-basis' ] ) basis = R[ 'flex-basis' ];
	cs.grow = grow; cs.shrink = shrink; cs.basis = basis;
	cs.alignItems = R[ 'align-items' ] || ( R[ 'place-items' ] ? R[ 'place-items' ].split( ' ' )[ 0 ] : 'stretch' );
	cs.alignSelf = R[ 'align-self' ] || 'auto';
	cs.justify = R[ 'justify-content' ] || 'flex-start';
	cs.grid = R[ 'grid-template-columns' ] || null;
	const ov = ( R.overflow || 'visible' ).split( /\s+/ );
	cs.ovX = R[ 'overflow-x' ] || ov[ 0 ];
	cs.ovY = R[ 'overflow-y' ] || ov[ 1 ] || ov[ 0 ];
	cs.ellipsis = R[ 'text-overflow' ] === 'ellipsis';
	cs.clamp = R[ '-webkit-line-clamp' ] ? Number( R[ '-webkit-line-clamp' ] ) : 0;
	const bg = R.background || R[ 'background-color' ] || '';
	cs.bg = bg && ! /^(none|transparent)$/.test( bg ) ? parseColor( bg ) : null;
	cs.radius = evalLen( ( R[ 'border-radius' ] || '0' ).split( ' ' )[ 0 ], ctx ) ?? 0;
	cs.opacity = R.opacity !== undefined ? Number( R.opacity ) : 1;
	return cs;

}

// =============================================================================================== layout
const BLOCKISH = new Set( [ 'block', 'flex', 'grid', 'list-item', '-webkit-box', 'table' ] );
const isBlock = ( n ) => n.cs && BLOCKISH.has( n.cs.display );
const inFlow = ( n ) => n.text !== undefined || ( n.cs.display !== 'none' && n.cs.position !== 'absolute' && n.cs.position !== 'fixed' );
const len = ( v, base, el, L ) => evalLen( v, { fs: el.cs.fs, W: L.W, H: L.H, pct: base } );
const fontOf = ( cs ) => ( { size: cs.fs, weight: cs.weight, mono: cs.mono, upper: cs.upper, ls: cs.ls } );
const desc = ( el ) => {

	const path = [];
	for ( let p = el; p && p.tag && p.tag !== 'body' && path.length < 3; p = p.parent ) path.unshift( p.tag + ( p.classes && p.classes.size ? '.' + [ ...p.classes ].slice( 0, 2 ).join( '.' ) : '' ) );
	return path.join( ' > ' );

};
const textOf = ( el ) => ( el.text !== undefined ? el.text : el.children.map( textOf ).join( '' ) ).replace( /\s+/g, ' ' ).trim();

// an anonymous block for text / inline runs sitting in a flex or grid container
function anon( nodes, parent ) {

	const a = { tag: '#anon', attrs: {}, classes: new Set(), children: nodes, parent, anon: true };
	a.cs = { ...parent.cs, display: 'block', pad: [ 0, 0, 0, 0 ], mar: [ 0, 0, 0, 0 ], border: 0, width: undefined, minW: undefined, maxW: undefined, height: undefined, minH: undefined, maxH: undefined,
		position: 'static', grow: 0, shrink: 1, basis: 'auto', bg: null, ovX: 'visible', ovY: 'visible', alignSelf: 'auto', grid: null, clamp: 0 };
	return a;

}

// the children of a flex / grid container as items (runs of text and inline elements become one anonymous item)
function itemsOf( el ) {

	const out = [];
	let run = [];
	const flush = () => { if ( run.some( ( n ) => n.text === undefined || n.text.trim() ) ) out.push( anon( run, el ) ); run = []; };
	for ( const c of el.children ) {

		if ( c.text === undefined && ! inFlow( c ) ) continue;
		if ( c.text !== undefined ) run.push( c );
		else { flush(); out.push( c ); } // (a flex / grid item is blockified)

	}

	flush();
	return out;

}

// inline tokens: words, spaces, atoms (inline-blocks, buttons, images, padded inline boxes), breaks
function tokens( nodes, out = [], nowrap = false ) {

	for ( const n of nodes ) {

		if ( n.text !== undefined ) {

			const cs = n.parent.cs;
			const f = fontOf( cs );
			const t = n.text.replace( /\s+/g, ' ' );
			if ( cs.nowrap || nowrap ) {

				const parts = t.split( / /g );
				parts.forEach( ( p, i ) => {

					if ( i > 0 ) out.push( { sp: true, w: textWidth( ' ', f ), glue: true, f, cs } );
					if ( p ) out.push( { word: p, w: textWidth( p, f ), f, cs, el: n.parent } );

				} );

			} else for ( const p of t.split( /( )/ ) ) {

				if ( p === ' ' ) out.push( { sp: true, w: textWidth( ' ', f ), f, cs } );
				else if ( p ) out.push( { word: p, w: textWidth( p, f ), f, cs, el: n.parent } );

			}

			continue;

		}

		if ( ! inFlow( n ) ) continue;
		if ( n.tag === 'br' ) { out.push( { br: true } ); continue; }
		const atomic = n.cs.display === 'inline-block' || n.cs.display === 'inline-flex' || n.cs.display === 'inline-grid' || n.tag === 'img' || n.tag === 'button' || n.tag === 'input'
			|| ( n.cs.display === 'inline' && ( n.cs.pad[ 1 ] > 2 || n.cs.pad[ 3 ] > 2 || n.cs.bg ) );
		if ( atomic ) { out.push( { atom: n } ); continue; }
		tokens( n.children, out, nowrap || n.cs.nowrap );

	}

	return out;

}

const pads = ( cs ) => cs.pad[ 1 ] + cs.pad[ 3 ] + 2 * cs.border;

// intrinsic widths { min, max } (border box)
export function measure( el, L ) {

	if ( el._m ) return el._m;
	const cs = el.cs;
	if ( cs.display === 'none' ) return ( el._m = { min: 0, max: 0 } );
	let min = 0, max = 0;
	const fixed = el.tag === 'img' ? ( len( cs.width, null, el, L ) ?? len( cs.height, null, el, L ) ?? 64 ) : len( cs.width, null, el, L );
	if ( fixed !== null && fixed !== undefined ) { min = max = fixed; }
	else {

		const d = cs.display;
		if ( d === 'flex' || d === 'inline-flex' ) {

			const items = itemsOf( el ).map( ( it ) => ( { it, m: measure( it, L ), mw: itemMin( it, L ) } ) );
			const gaps = Math.max( 0, items.length - 1 ) * cs.colGap;
			if ( cs.flexDir.startsWith( 'column' ) ) { for ( const x of items ) { min = Math.max( min, x.mw ); max = Math.max( max, x.m.max ); } }
			else {

				max = items.reduce( ( s, x ) => s + x.m.max + x.it.cs.mar[ 1 ] + x.it.cs.mar[ 3 ], 0 ) + gaps;
				min = cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse' ? Math.max( 0, ...items.map( ( x ) => x.mw ) ) : items.reduce( ( s, x ) => s + x.mw, 0 ) + gaps;

			}

		} else if ( d === 'grid' || d === 'inline-grid' ) {

			const tracks = gridTracks( el, L );
			const items = itemsOf( el );
			const n = tracks.length;
			for ( let t = 0; t < n; t ++ ) {

				const col = items.filter( ( _, i ) => i % n === t ).map( ( it ) => ( { m: measure( it, L ), mw: itemMin( it, L ) } ) );
				const tk = tracks[ t ];
				const cmin = Math.max( 0, ...col.map( ( x ) => x.mw ) ), cmax = Math.max( 0, ...col.map( ( x ) => x.m.max ) );
				min += tk.px !== undefined ? tk.px : tk.fr && tk.min0 ? 0 : cmin;
				max += tk.px !== undefined ? tk.px : Math.max( cmax, tk.fr ? cmin : 0 );

			}

			if ( tracks.some( ( t ) => t.fr ) ) { const frMax = Math.max( 0, ...tracks.map( ( t, i ) => ( t.fr ? Math.max( 0, ...items.filter( ( _, k ) => k % n === i ).map( ( it ) => measure( it, L ).max ) ) : 0 ) ) ); max = Math.max( max, frMax * tracks.filter( ( t ) => t.fr ).length + tracks.reduce( ( s, t ) => s + ( t.px || 0 ), 0 ) ); }
			min += Math.max( 0, n - 1 ) * cs.colGap;
			max += Math.max( 0, n - 1 ) * cs.colGap;

		} else {

			// flow: inline runs and blocks
			let line = 0;
			const endLine = () => { max = Math.max( max, line ); line = 0; };
			for ( const c of el.children ) {

				if ( c.text === undefined && ! inFlow( c ) ) continue;
				if ( c.text === undefined && isBlock( c ) ) {

					endLine();
					const m = measure( c, L );
					min = Math.max( min, m.min + c.cs.mar[ 1 ] + c.cs.mar[ 3 ] );
					max = Math.max( max, m.max + c.cs.mar[ 1 ] + c.cs.mar[ 3 ] );
					continue;

				}

				const toks = tokens( [ c ], [], cs.nowrap );
				let glued = 0;
				for ( const t of toks ) {

					if ( t.br ) { endLine(); glued = 0; continue; }
					const w = t.atom ? measure( t.atom, L ).max : t.w;
					const mw = t.atom ? measure( t.atom, L ).min : t.w;
					line += w;
					if ( t.sp && ! t.glue && ! cs.nowrap ) { glued = 0; continue; }
					glued += t.sp ? t.w : mw;
					min = Math.max( min, cs.nowrap ? line : glued );
					if ( ! t.sp && ! t.glue && ! cs.nowrap && t.atom ) glued = 0;

				}

			}

			endLine();
			if ( cs.nowrap ) min = max;

		}

		min += pads( cs );
		max += pads( cs );

	}

	const mn = len( cs.minW, null, el, L ), mx = len( cs.maxW, null, el, L );
	if ( mx !== null && mx !== undefined ) { max = Math.min( max, mx ); min = Math.min( min, mx ); }
	if ( mn !== null && mn !== undefined ) { min = Math.max( min, mn ); max = Math.max( max, mn ); }
	if ( cs.ovX !== 'visible' && cs.ellipsis ) min = pads( cs ) + ( mn || 0 );
	return ( el._m = { min, max: Math.max( min, max ) } );

}

// a flex / grid item's automatic minimum: min-content unless it scrolls / clips
function itemMin( it, L ) {

	const mn = len( it.cs.minW, null, it, L );
	if ( mn !== null && mn !== undefined ) return mn;
	return it.cs.ovX !== 'visible' ? pads( it.cs ) : measure( it, L ).min;

}

function gridTracks( el, L ) {

	let t = el.cs.grid;
	if ( ! t ) return [ { fr: 1, min0: false } ];
	t = t.replace( /repeat\(\s*(\d+)\s*,\s*([^)]*(?:\([^)]*\))?[^)]*)\)/g, ( m, n, x ) => Array( Number( n ) ).fill( x.trim() ).join( ' ' ) );
	return splitTop( t, ' ' ).map( ( x ) => {

		const fr = /^([\d.]+)fr$/.exec( x );
		if ( fr ) return { fr: Number( fr[ 1 ] ), min0: false };
		const mm = /^minmax\(\s*([^,]+),\s*([\d.]+)fr\s*\)$/.exec( x );
		if ( mm ) return { fr: Number( mm[ 2 ] ), min0: ( evalLen( mm[ 1 ], { fs: el.cs.fs, W: L.W, H: L.H } ) ?? 0 ) === 0 };
		if ( x === 'auto' || x === 'max-content' || x === 'min-content' ) return { auto: true };
		const px = evalLen( x, { fs: el.cs.fs, W: L.W, H: L.H } );
		return px !== null ? { px } : { auto: true };

	} );

}

function issue( L, type, el, extra = {} ) {

	if ( L.clip > 0 && type === 'overflow' ) return;
	L.issues.push( { type, at: desc( el ), el, ...extra } );

}

// lays out el at width w (border box; null: from its own width or availW); returns a box { el, w, h, kids: [ { box, x, y } ], runs }
export function layout( el, availW, L, { shrink = false, forceW = null } = {} ) {

	const cs = el.cs;
	let w;
	if ( forceW !== null ) w = forceW;
	else {

		const ws = el.tag === 'img' ? measure( el, L ).max : len( cs.width, availW, el, L );
		if ( ws !== null && ws !== undefined ) w = ws;
		else if ( shrink ) { const m = measure( el, L ); w = Math.min( Math.max( m.min, availW ), m.max ); }
		else w = availW - cs.mar[ 1 ] - cs.mar[ 3 ];

	}

	const mx = len( cs.maxW, availW, el, L ), mn = len( cs.minW, availW, el, L );
	if ( mx !== null && mx !== undefined && forceW === null ) w = Math.min( w, mx );
	if ( mn !== null && mn !== undefined ) w = Math.max( w, mn );
	if ( mn && mn > availW + 0.5 && forceW === null ) issue( L, 'overflow', el, { by: mn - availW, why: 'min-width' } );
	const box = { el, w, h: 0, kids: [], runs: [] };
	const cw = Math.max( 0, w - pads( cs ) );
	const clips = cs.ovX === 'hidden' || cs.ovX === 'clip';
	if ( clips ) L.clip ++;
	let ch;
	const d = cs.display;
	if ( el.tag === 'img' ) ch = len( cs.height, null, el, L ) ?? measure( el, L ).max;
	else if ( d === 'flex' || d === 'inline-flex' ) ch = cs.flexDir.startsWith( 'column' ) ? flexCol( el, box, cw, L ) : flexRow( el, box, cw, L );
	else if ( d === 'grid' || d === 'inline-grid' ) ch = grid( el, box, cw, L );
	else ch = flow( el, box, cw, L );
	if ( clips ) L.clip --;
	if ( cs.ovX === 'auto' && measure( el, L ).min > w + 1 && ! clips ) issue( L, 'overflow', el, { by: measure( el, L ).min - w, why: 'scrolls sideways' } );
	box.contentH = ch;
	let h = ch + cs.pad[ 0 ] + cs.pad[ 2 ] + 2 * cs.border;
	const hs = len( cs.height, null, el, L );
	if ( hs !== null && hs !== undefined ) h = hs;
	const mxh = len( cs.maxH, L.H, el, L ), mnh = len( cs.minH, L.H, el, L );
	if ( mxh !== null && mxh !== undefined ) h = Math.min( h, mxh );
	if ( mnh !== null && mnh !== undefined ) h = Math.max( h, mnh );
	box.h = h;
	box.minH = mnh || 0;
	return box;

}

function flow( el, box, cw, L ) {

	const cs = el.cs;
	let y = 0, prevMar = 0, run = [];
	const x0 = cs.pad[ 3 ] + cs.border, y0 = cs.pad[ 0 ] + cs.border;
	const flushRun = () => {

		if ( ! run.length ) return;
		const toks = tokens( run, [], cs.nowrap );
		run = [];
		if ( ! toks.some( ( t ) => t.word || t.atom ) ) return;
		y += prevMar;
		prevMar = 0;
		y += inline( el, toks, box, cw, L, x0, y0 + y );

	};

	for ( const c of el.children ) {

		if ( c.text === undefined && ! inFlow( c ) ) {

			if ( c.text === undefined && c.cs.display !== 'none' ) {

				// absolutely positioned: shrink to fit, placed by its right / left and top
				const b = layout( c, cw, L, { shrink: true } );
				const r = len( c.cs.right, cw, c, L ), t = len( c.cs.top, null, c, L );
				box.kids.push( { box: b, x: r !== null && r !== undefined ? box.w - r - b.w : x0, y: t ?? 0, abs: true } );

			}

			continue;

		}

		if ( c.text === undefined && isBlock( c ) ) {

			flushRun();
			const b = layout( c, cw, L );
			y += Math.max( prevMar, c.cs.mar[ 0 ] );
			box.kids.push( { box: b, x: x0 + c.cs.mar[ 3 ], y: y0 + y } );
			y += b.h;
			prevMar = c.cs.mar[ 2 ];
			continue;

		}

		run.push( c );

	}

	flushRun();
	return y + ( box.kids.length && ! box.runs.length ? 0 : 0 );

}

// line breaking of the tokens into width cw; returns the height
function inline( el, toks, box, cw, L, x0, y0 ) {

	const cs = el.cs;
	const lines = [];
	let line = { items: [], w: 0, h: cs.lh };
	let pend = 0;
	const clipped = L.clip > 0 || ( cs.ovX !== 'visible' && cs.ellipsis );
	const nl = () => { lines.push( line ); line = { items: [], w: 0, h: cs.lh }; pend = 0; };
	for ( const t of toks ) {

		if ( t.br ) { nl(); continue; }
		if ( t.sp ) { if ( line.items.length ) pend += t.w; continue; }
		let w, h, ab = null;
		if ( t.atom ) {

			ab = layout( t.atom, cw, L, { shrink: true } );
			w = ab.w + t.atom.cs.mar[ 1 ] + t.atom.cs.mar[ 3 ];
			h = ab.h + t.atom.cs.mar[ 0 ] + t.atom.cs.mar[ 2 ];

		} else { w = t.w; h = t.cs.lh; }

		// glued words (nowrap) never break apart
		const glue = toks[ toks.indexOf( t ) - 1 ]?.glue;
		if ( line.items.length && ! glue && ! cs.nowrap && line.w + pend + w > cw + 0.5 ) nl();
		line.w += ( line.items.length ? pend : 0 );
		pend = 0;
		if ( ! line.items.length && w > cw + 0.5 && ! clipped && ! t.atom ) issue( L, 'overflow', t.el || el, { by: w - cw, text: t.word } );
		line.items.push( { t, x: line.w, w, h, ab } );
		line.w += w;
		line.h = Math.max( line.h, h );

	}

	if ( line.items.length ) lines.push( line );
	if ( cs.nowrap && ! clipped && lines.length && lines[ 0 ].w > cw + 0.5 ) issue( L, 'overflow', el, { by: lines[ 0 ].w - cw, text: textOf( el ).slice( 0, 60 ) } );
	let shown = lines;
	if ( cs.clamp && lines.length > cs.clamp ) shown = lines.slice( 0, cs.clamp );
	let y = 0;
	for ( const ln of shown ) {

		const off = cs.align === 'center' ? Math.max( 0, ( cw - ln.w ) / 2 ) : cs.align === 'right' || cs.align === 'end' ? Math.max( 0, cw - ln.w ) : 0;
		for ( const it of ln.items ) {

			const x = x0 + off + it.x;
			if ( it.ab ) box.kids.push( { box: it.ab, x: x + it.t.atom.cs.mar[ 3 ], y: y0 + y + ( ln.h - it.h ) / 2 + it.t.atom.cs.mar[ 0 ] } );
			else box.runs.push( { x, y: y0 + y + ( ln.h - it.t.cs.lh ) / 2, w: it.w, h: it.t.cs.lh, text: it.t.f.upper ? it.t.word.toUpperCase() : it.t.word, f: it.t.f, color: it.t.cs.color, op: opacityOf( it.t.el ) } );

		}

		y += ln.h;

	}

	// a nowrap line wider than its box with an ellipsis: the drawing is cut at the box
	if ( clipped && shown.length ) for ( const r of box.runs ) if ( r.x + r.w > x0 + cw + 0.5 ) { r.cut = x0 + cw; }
	if ( cs.ellipsis && shown.length && shown[ 0 ].w > cw + 0.5 ) L.issues.push( { type: 'truncated', at: desc( el ), el, by: shown[ 0 ].w - cw, text: textOf( el ).slice( 0, 60 ) } );
	if ( cs.clamp && lines.length > cs.clamp ) L.issues.push( { type: 'truncated', at: desc( el ), el, by: lines.length - cs.clamp, text: textOf( el ).slice( 0, 60 ), why: 'lines' } );
	return y;

}

function opacityOf( el ) {

	let o = 1;
	for ( let p = el; p && p.cs; p = p.parent ) o *= p.cs.opacity ?? 1;
	return o;

}

function flexRow( el, box, cw, L ) {

	const cs = el.cs;
	const items = itemsOf( el );
	const wrap = cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse';
	const gap = cs.colGap;
	const info = items.map( ( it ) => {

		const m = measure( it, L );
		const b = len( it.cs.basis, cw, it, L );
		const ws = len( it.cs.width, cw, it, L );
		const mar = it.cs.mar[ 1 ] + it.cs.mar[ 3 ];
		let base = b !== null && b !== undefined && it.cs.basis !== 'auto' ? b : ws ?? m.max;
		const mn = itemMin( it, L );
		const mx = len( it.cs.maxW, cw, it, L );
		if ( mx !== null && mx !== undefined ) base = Math.min( base, mx );
		return { it, base: Math.max( base, mn ), min: mn, grow: it.cs.grow, shrink: it.cs.shrink, mar };

	} );

	const lines = [];
	let cur = [], used = 0;
	for ( const x of info ) {

		const need = Math.min( x.base, cw ) + x.mar + ( cur.length ? gap : 0 );
		if ( wrap && cur.length && used + need > cw + 0.5 ) { lines.push( cur ); cur = []; used = 0; }
		used += Math.min( x.base, cw ) + x.mar + ( cur.length ? gap : 0 );
		cur.push( x );

	}

	if ( cur.length ) lines.push( cur );
	let y = 0;
	const x0 = cs.pad[ 3 ] + cs.border, y0 = cs.pad[ 0 ] + cs.border;
	for ( const ln of lines ) {

		for ( const x of ln ) x.w = wrap ? Math.min( x.base, cw ) : x.base;
		let free = cw - ln.reduce( ( s, x ) => s + x.w + x.mar, 0 ) - gap * ( ln.length - 1 );
		if ( free > 0 ) {

			const g = ln.reduce( ( s, x ) => s + x.grow, 0 );
			if ( g > 0 ) for ( const x of ln ) x.w += free * x.grow / g;

		} else if ( free < 0 ) {

			for ( let k = 0; k < 6 && free < - 0.01; k ++ ) {

				const act = ln.filter( ( x ) => x.shrink > 0 && x.w > x.min + 0.01 );
				const tot = act.reduce( ( s, x ) => s + x.shrink * x.w, 0 );
				if ( ! tot ) break;
				for ( const x of act ) {

					const cut = - free * x.shrink * x.w / tot;
					x.w = Math.max( x.min, x.w - cut );

				}

				free = cw - ln.reduce( ( s, x ) => s + x.w + x.mar, 0 ) - gap * ( ln.length - 1 );

			}

			if ( free < - 0.5 ) issue( L, 'overflow', el, { by: - free, text: textOf( el ).slice( 0, 60 ) } );

		}

		let lh = 0;
		const boxes = ln.map( ( x ) => { const b = layout( x.it, x.w, L, { forceW: x.w } ); lh = Math.max( lh, b.h + x.it.cs.mar[ 0 ] + x.it.cs.mar[ 2 ] ); return b; } );
		const totalW = ln.reduce( ( s, x ) => s + x.w + x.mar, 0 ) + gap * ( ln.length - 1 );
		let xx = cs.justify === 'flex-end' || cs.justify === 'end' ? cw - totalW : cs.justify === 'center' ? ( cw - totalW ) / 2 : 0;
		const between = cs.justify === 'space-between' && ln.length > 1 ? Math.max( 0, cw - totalW ) / ( ln.length - 1 ) : 0;
		ln.forEach( ( x, i ) => {

			const b = boxes[ i ];
			const ay = cs.alignItems === 'center' ? ( lh - b.h ) / 2 : cs.alignItems === 'flex-end' || cs.alignItems === 'end' ? lh - b.h : 0;
			box.kids.push( { box: b, x: x0 + xx + x.it.cs.mar[ 3 ], y: y0 + y + ay + x.it.cs.mar[ 0 ] } );
			xx += x.w + x.mar + gap + between;

		} );

		y += lh + ( lines.length > 1 ? cs.rowGap : 0 );

	}

	if ( lines.length > 1 ) y -= cs.rowGap;
	return y;

}

// a column: items stacked; a definite max height (a panel) makes the scrolling items give way first
function flexCol( el, box, cw, L ) {

	const cs = el.cs;
	const items = itemsOf( el );
	const x0 = cs.pad[ 3 ] + cs.border, y0 = cs.pad[ 0 ] + cs.border;
	const placed = items.map( ( it ) => {

		const self = it.cs.alignSelf !== 'auto' ? it.cs.alignSelf : cs.alignItems;
		const shrinkW = self === 'flex-start' || self === 'center' || self === 'flex-end' || self === 'start' || self === 'end';
		const b = layout( it, cw, L, { shrink: shrinkW } );
		const off = self === 'center' ? ( cw - b.w ) / 2 : self === 'flex-end' || self === 'end' ? cw - b.w : 0;
		return { it, b, off };

	} );

	const limitRaw = len( cs.maxH, L.H, el, L );
	const fixedH = len( cs.height, L.H, el, L );
	const limit = ( fixedH ?? limitRaw );
	let total = placed.reduce( ( s, p ) => s + p.b.h + p.it.cs.mar[ 0 ] + p.it.cs.mar[ 2 ], 0 ) + cs.rowGap * Math.max( 0, placed.length - 1 );
	if ( limit !== null && limit !== undefined ) {

		const room = limit - cs.pad[ 0 ] - cs.pad[ 2 ] - 2 * cs.border;
		if ( total > room ) {

			// items that scroll or clip (overflow-y not visible: min-height auto is 0) shrink in proportion to their
			// height, down to their min-height; the others keep their content height
			let excess = total - room;
			for ( let k = 0; k < 6 && excess > 0.01; k ++ ) {

				const flexible = placed.filter( ( p ) => p.it.cs.shrink > 0 && p.it.cs.ovY !== 'visible' && p.b.h > ( p.b.minH || 0 ) + 0.01 );
				const tot = flexible.reduce( ( s, p ) => s + p.b.h * p.it.cs.shrink, 0 );
				if ( ! tot ) break;
				let cutAll = 0;
				for ( const p of flexible ) {

					const cut = Math.min( p.b.h - ( p.b.minH || 0 ), excess * p.b.h * p.it.cs.shrink / tot );
					p.b.h -= cut;
					p.b.scrolls = true;
					cutAll += cut;

				}

				excess -= cutAll;

			}

			total = room + Math.max( 0, excess );

		}

	}

	let y = 0;
	for ( const p of placed ) {

		y += p.it.cs.mar[ 0 ];
		box.kids.push( { box: p.b, x: x0 + p.off + p.it.cs.mar[ 3 ], y: y0 + y } );
		y += p.b.h + p.it.cs.mar[ 2 ] + cs.rowGap;

	}

	return Math.max( 0, y - ( placed.length ? cs.rowGap : 0 ) );

}

function grid( el, box, cw, L ) {

	const cs = el.cs;
	const tracks = gridTracks( el, L );
	const n = tracks.length;
	const items = itemsOf( el );
	const gapX = cs.colGap, gapY = cs.rowGap;
	const avail = cw - gapX * ( n - 1 );
	const cols = tracks.map( ( tk, t ) => {

		const col = items.filter( ( _, i ) => i % n === t );
		const mins = col.map( ( it ) => itemMin( it, L ) ), maxs = col.map( ( it ) => measure( it, L ).max );
		return { tk, min: tk.px !== undefined ? tk.px : tk.fr && tk.min0 ? 0 : Math.max( 0, ...mins ), max: tk.px !== undefined ? tk.px : Math.max( 0, ...maxs ), need: Math.max( 0, ...mins ), w: 0 };

	} );

	const fixed = cols.filter( ( c ) => c.tk.px !== undefined ).reduce( ( s, c ) => s + c.tk.px, 0 );
	const autos = cols.filter( ( c ) => c.tk.auto ), frs = cols.filter( ( c ) => c.tk.fr );
	for ( const c of cols ) c.w = c.tk.px !== undefined ? c.tk.px : c.tk.auto ? c.max : c.min;
	let left = avail - cols.reduce( ( s, c ) => s + c.w, 0 );
	if ( left < 0 ) {

		// autos give way down to their minimum
		for ( const c of autos ) { const cut = Math.min( c.w - c.min, - left ); c.w -= cut; left += cut; }

	}

	if ( left > 0 && frs.length ) {

		// the fr tracks share what is left (each keeps its minimum)
		const totalFr = frs.reduce( ( s, c ) => s + c.tk.fr, 0 );
		let pool = avail - fixed - autos.reduce( ( s, c ) => s + c.w, 0 );
		const share = ( c ) => pool * c.tk.fr / totalFr;
		const big = frs.filter( ( c ) => c.min > share( c ) );
		for ( const c of big ) { c.w = c.min; pool -= c.min; }
		const rest = frs.filter( ( c ) => ! big.includes( c ) );
		const fr2 = rest.reduce( ( s, c ) => s + c.tk.fr, 0 );
		for ( const c of rest ) c.w = Math.max( c.min, pool * c.tk.fr / fr2 );
		left = 0;

	} else if ( left > 0 && autos.length && ! frs.length ) { for ( const c of autos ) c.w += left / autos.length; left = 0; }

	if ( left < - 0.5 ) issue( L, 'overflow', el, { by: - left, text: textOf( el ).slice( 0, 60 ) } );
	// a fr column squeezed below what its content needs (minmax(0, 1fr)): the words spill into the next column
	for ( const c of frs ) if ( c.tk.min0 && c.w + 0.5 < c.need ) issue( L, 'overflow', el, { by: c.need - c.w, text: 'a column squeezed: ' + textOf( el ).slice( 0, 50 ) } );
	const x0 = cs.pad[ 3 ] + cs.border, y0 = cs.pad[ 0 ] + cs.border;
	let y = 0;
	for ( let r = 0; r * n < items.length; r ++ ) {

		let rh = 0, x = 0;
		const row = items.slice( r * n, r * n + n ).map( ( it, t ) => {

			const b = layout( it, cols[ t ].w, L, { forceW: Math.max( cols[ t ].w, 0 ) } );
			rh = Math.max( rh, b.h + it.cs.mar[ 0 ] + it.cs.mar[ 2 ] );
			return b;

		} );

		row.forEach( ( b, t ) => {

			const ay = cs.alignItems === 'center' ? ( rh - b.h ) / 2 : 0;
			box.kids.push( { box: b, x: x0 + x, y: y0 + y + ay } );
			x += cols[ t ].w + gapX;

		} );

		y += rh + gapY;

	}

	return Math.max( 0, y - ( items.length ? gapY : 0 ) );

}

// =============================================================================================== a panel on a screen
export const SIZES = [
	{ id: 'desk720', W: 1280, H: 720, touch: false },
	{ id: 'desk1080', W: 1920, H: 1080, touch: false },
	{ id: 'phoneP', W: 390, H: 844, touch: true },
	{ id: 'phoneL', W: 844, H: 390, touch: true },
];

const JS_CSS = [ 'src/game/GameHUD.js', 'src/game/HudPanels.js', 'src/features/crew/index.js', 'src/features/harbour/PanelKit.js', 'src/features/navy/NavyPanel.js', 'src/game/Guide.js' ];
let RULES = null;
export function loadRules() {

	const rules = [ ...UA, ...parseCSS( read( 'src/ui/ui.css' ) ) ];
	for ( const f of JS_CSS ) {

		const m = /const CSS = (?:\/\* css \*\/)?`([\s\S]*?)`;/.exec( read( f ) );
		if ( m ) rules.push( ...parseCSS( m[ 1 ] ) );

	}

	return ( RULES = rules );

}

const INTERACTIVE = ( el ) => el.tag === 'button' || el.attrs[ 'data-act' ] !== undefined || el.attrs[ 'data-nv' ] !== undefined || el.attrs.role === 'button' || el.attrs.role === 'tab';

// panel: { id, cls: 'gm-panel' | 'hb-panel' | 'nv-panel' | 'gm-guide-card' | 'tw-toasts', html, host: 'root' | 'hud', wrap? }
export function audit( panel, size, lang = 'en' ) {

	const V = { W: size.W, H: size.H, touch: size.touch };
	const L = { W: size.W, H: size.H, issues: [], clip: 0 };
	const html = mkEl( 'html' );
	const body = mkEl( 'body', {}, html );
	const root = mkEl( 'div', { class: 'tw-root' + ( size.touch ? ' is-coarse is-touch' : '' ), 'data-panel': 'closed' }, body );
	const hud = panel.host === 'root' ? root : mkEl( 'div', { class: 'tw-hud' }, root );
	const outer = panel.wrap ? parseHTML( panel.wrap, hud ).children[ panel.wrap ? hud.children.length - 1 : 0 ] : hud;
	const el = mkEl( 'div', { class: `${ panel.cls }${ panel.glass === false ? '' : ' tw-glass' } tw-interactive is-open is-on is-in` }, panel.wrap ? deepest( outer ) : hud );
	parseHTML( panel.html, el );
	if ( lang !== 'en' && panel.translate ) panel.translate( el );
	computeStyles( html, RULES || loadRules(), V );
	// the panel's box: its own width rules against the viewport, centred (translate -50%) or at its top
	const b = layout( el, size.W, L, { shrink: true } );
	const cs = el.cs;
	const topRaw = cs.top;
	const centred = /translate\(\s*-50%\s*,\s*-(48|50)%\s*\)/.test( cs.transform ) || panel.centre;
	let x = ( size.W - b.w ) / 2, y;
	if ( centred ) y = ( size.H - b.h ) / 2;
	else y = evalLen( topRaw, { fs: cs.fs, W: size.W, H: size.H, pct: size.H } ) ?? 0;
	if ( panel.cls === 'tw-toasts' ) y = evalLen( cs.top, { fs: cs.fs, W: size.W, H: size.H } ) ?? 16;
	// tall content: the panel's own max-height, then it scrolls (overflow-y auto) or spills
	const content = b.contentH + cs.pad[ 0 ] + cs.pad[ 2 ] + 2 * cs.border;
	const scrolls = cs.ovY === 'auto' || cs.ovY === 'scroll' || hasScroller( b );
	if ( ! scrolls && content > b.h + 1 ) issue( L, 'clipped-y', el, { by: content - b.h } );
	if ( y < - 0.5 || y + b.h > size.H + 0.5 ) issue( L, 'off-screen', el, { by: Math.max( - y, y + b.h - size.H ) } );
	if ( b.w > size.W + 0.5 ) issue( L, 'overflow', el, { by: b.w - size.W, why: 'wider than the screen' } );
	// tap targets on touch
	const flat = flatten( b, x, y );
	if ( size.touch ) for ( const k of flat ) {

		const e = k.box.el;
		if ( ! e.tag || ! INTERACTIVE( e ) || e.attrs.disabled !== undefined || e.cs.display === 'none' ) continue;
		if ( k.box.w < 43.5 || k.box.h < 43.5 ) L.issues.push( { type: 'tap', at: desc( e ), el: e, w: Math.round( k.box.w ), h: Math.round( k.box.h ), text: textOf( e ).slice( 0, 30 ), x: k.x, y: k.y, bw: k.box.w, bh: k.box.h } );

	}

	// English left in a Romanian panel
	if ( lang === 'ro' ) for ( const t of textNodes( el ) ) {

		const s = t.text.replace( /\s+/g, ' ' ).trim();
		if ( isEnglish( s ) ) L.issues.push( { type: 'english', at: desc( t.parent ), el: t.parent, text: s.slice( 0, 80 ) } );

	}

	for ( const i of L.issues ) if ( i.x === undefined ) { const k = flat.find( ( f ) => f.box.el === i.el ); if ( k ) { i.x = k.x; i.y = k.y; i.bw = k.box.w; i.bh = k.box.h; } }
	return { box: b, x, y, issues: L.issues, flat, size, panel, lang };

}

function deepest( el ) {

	let e = el;
	while ( e.children.some( ( c ) => c.tag ) ) e = e.children.filter( ( c ) => c.tag ).pop();
	return e;

}

function hasScroller( b ) {

	if ( b.scrolls ) return true;
	return b.kids.some( ( k ) => ! k.abs && hasScroller( k.box ) );

}

export function flatten( b, x, y, out = [], clip = null ) {

	out.push( { box: b, x, y, clip } );
	// a scroller (or a box that clips) shows only what fits inside it
	const cs = b.el.cs;
	let c = clip;
	if ( b.scrolls || ( cs && ( cs.ovY !== 'visible' || cs.ovX === 'hidden' ) ) ) {

		const r = [ x, y, x + b.w, y + b.h ];
		c = clip ? [ Math.max( clip[ 0 ], r[ 0 ] ), Math.max( clip[ 1 ], r[ 1 ] ), Math.min( clip[ 2 ], r[ 2 ] ), Math.min( clip[ 3 ], r[ 3 ] ) ] : r;

	}

	for ( const k of b.kids ) flatten( k.box, x + k.x, y + k.y, out, c );
	return out;

}

export function textNodes( el, out = [] ) {

	for ( const c of el.children || [] ) {

		if ( c.text !== undefined ) { if ( c.text.trim() ) out.push( c ); }
		else if ( c.cs ? c.cs.display !== 'none' : true ) textNodes( c, out );

	}

	return out;

}

const EN_WORDS = /\b(the|and|you|your|of|to|is|are|for|with|at|on|from|has|have|no|not|a|an|in|off|out|her|his|them|it|its|this|that|be|by|will|get|now|then|here|there|every|one|all|aboard|ship|navy|crew|hands?|day|week)\b/gi;
export function isEnglish( s ) {

	if ( ! s || /[ăâîșțĂÂÎȘȚ]/.test( s ) ) return false;
	const words = s.match( /[A-Za-z']{2,}/g ) || [];
	if ( words.length < 2 ) return false;
	const en = ( s.match( EN_WORDS ) || [] ).length;
	return en >= 2 && en / words.length >= 0.25;

}

// =============================================================================================== drawing (captures)
// the laid-out boxes as a display list; issues outlined in red. Drawn by System.Drawing (PowerShell): no browser.
const PS1 = String.raw`param([string]$Json, [string]$Out, [string]$Bg)
Add-Type -AssemblyName System.Drawing
$d = Get-Content -Raw -Encoding UTF8 $Json | ConvertFrom-Json
$bmp = New-Object System.Drawing.Bitmap ([int]$d.W), ([int]$d.H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
if ($Bg -and (Test-Path $Bg)) {
	$img = [System.Drawing.Image]::FromFile($Bg)
	$s = [Math]::Max($d.W / $img.Width, $d.H / $img.Height)
	$w = $img.Width * $s; $h = $img.Height * $s
	$g.DrawImage($img, [single](($d.W - $w) / 2), [single](($d.H - $h) / 2), [single]$w, [single]$h)
	$img.Dispose()
} else { $g.Clear([System.Drawing.Color]::FromArgb(255, 40, 70, 90)) }
function Col($c) { [System.Drawing.Color]::FromArgb([int][Math]::Max(0, [Math]::Min(255, $c[3] * 255)), [int]$c[0], [int]$c[1], [int]$c[2]) }
function RRect($x, $y, $w, $h, $r) {
	$p = New-Object System.Drawing.Drawing2D.GraphicsPath
	$r = [Math]::Max(0.5, [Math]::Min($r, [Math]::Min($w, $h) / 2))
	$p.AddArc([single]$x, [single]$y, [single](2 * $r), [single](2 * $r), 180, 90)
	$p.AddArc([single]($x + $w - 2 * $r), [single]$y, [single](2 * $r), [single](2 * $r), 270, 90)
	$p.AddArc([single]($x + $w - 2 * $r), [single]($y + $h - 2 * $r), [single](2 * $r), [single](2 * $r), 0, 90)
	$p.AddArc([single]$x, [single]($y + $h - 2 * $r), [single](2 * $r), [single](2 * $r), 90, 90)
	$p.CloseFigure(); return $p
}
foreach ($it in $d.items) {
	if ($it.clip) { $g.SetClip((New-Object System.Drawing.RectangleF ([single]$it.clip[0]), ([single]$it.clip[1]), ([single]($it.clip[2] - $it.clip[0])), ([single]($it.clip[3] - $it.clip[1])))) } else { $g.ResetClip() }
	if ($it.k -eq 'rect') {
		$path = RRect $it.x $it.y $it.w $it.h $it.r
		if ($it.fill) { $b = New-Object System.Drawing.SolidBrush (Col $it.fill); $g.FillPath($b, $path); $b.Dispose() }
		if ($it.line) { $pen = New-Object System.Drawing.Pen (Col $it.line), ([single]$it.lw); $g.DrawPath($pen, $path); $pen.Dispose() }
		$path.Dispose()
	} elseif ($it.k -eq 'text') {
		$style = if ($it.b) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
		$fam = if ($it.m) { 'Consolas' } else { 'Segoe UI' }
		$f = New-Object System.Drawing.Font $fam, ([single]$it.s), $style, ([System.Drawing.GraphicsUnit]::Pixel)
		$b = New-Object System.Drawing.SolidBrush (Col $it.c)
		if ($it.cut) { $g.IntersectClip((New-Object System.Drawing.RectangleF ([single]$it.x), ([single]$it.y), ([single]($it.cut - $it.x)), ([single]($it.s * 2)))) }
		$g.DrawString($it.t, $f, $b, [single]($it.x - $it.s * 0.12), [single]$it.y)
		$f.Dispose(); $b.Dispose()
	}
}
$g.ResetClip()
foreach ($is in $d.issues) {
	$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(235, 255, 40, 40)), 2
	$g.DrawRectangle($pen, [single]$is.x, [single]$is.y, [single][Math]::Max(4, $is.w), [single][Math]::Max(4, $is.h)); $pen.Dispose()
}
$f = New-Object System.Drawing.Font 'Consolas', 12, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 0, 0, 0))), 0, ([int]$d.H - 18), ([int]$d.W), 18)
$g.DrawString($d.label, $f, [System.Drawing.Brushes]::White, 4, ([int]$d.H - 16))
$g.Dispose(); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
`;

const GLASS = [ 14, 22, 32, 0.86 ];
export function displayList( a ) {

	const items = [];
	for ( const k of a.flat ) {

		const cs = k.box.el.cs;
		if ( ! cs || cs.display === 'none' ) continue;
		const isPanel = k.box.el === a.flat[ 0 ].box.el;
		const fill = isPanel ? GLASS : cs.bg && cs.bg[ 3 ] > 0.02 ? [ ...cs.bg.slice( 0, 3 ), Math.min( 1, cs.bg[ 3 ] * ( cs.opacity ?? 1 ) ) ] : null;
		const line = k.box.el.tag === 'button' || isPanel ? [ 170, 215, 235, 0.35 ] : null;
		const clip = k.clip;
		if ( clip && ( k.y >= clip[ 3 ] || k.y + k.box.h <= clip[ 1 ] ) ) continue;
		if ( fill || line ) items.push( { k: 'rect', x: k.x, y: k.y, w: k.box.w, h: k.box.h, r: Math.min( cs.radius || 0, 999 ), fill, line, lw: 1, clip } );
		// the words of a line in one string (drawn with the system's own spacing)
		const runs = [];
		for ( const r of k.box.runs ) {

			const p = runs[ runs.length - 1 ];
			const same = p && Math.abs( p.y - r.y ) < 0.5 && p.f === r.f && p.color === r.color && r.x - ( p.x + p.w ) < textWidth( '  ', r.f ) && r.cut === undefined && p.cut === undefined;
			if ( same ) { p.text += ( r.x - ( p.x + p.w ) > 0.5 ? ' ' : '' ) + r.text; p.w = r.x + r.w - p.x; }
			else runs.push( { ...r } );

		}

		for ( const r of runs ) items.push( { k: 'text', x: k.x + r.x, y: k.y + r.y + ( r.h - r.f.size * 1.33 ) / 2, s: r.f.size, b: r.f.weight >= 600, m: r.f.mono, t: r.text, c: [ ...r.color.slice( 0, 3 ), ( r.color[ 3 ] ?? 1 ) * ( r.op ?? 1 ) ], cut: r.cut !== undefined ? k.x + r.cut : null, clip } );

	}

	return items;

}

export function drawShot( a, file, bg, label ) {

	const dir = dirname( file );
	mkdirSync( dir, { recursive: true } );
	const ps = join( dir, '_draw.ps1' );
	writeFileSync( ps, PS1 );
	const issues = a.issues.filter( ( i ) => i.x !== undefined ).map( ( i ) => ( { x: i.x, y: i.y, w: i.bw, h: i.bh } ) );
	const json = file.replace( /\.png$/, '.json' );
	writeFileSync( json, JSON.stringify( { W: a.size.W, H: a.size.H, items: displayList( a ), issues, label } ) );
	execFileSync( 'powershell', [ '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Json', json, '-Out', file, '-Bg', bg || '' ], { stdio: 'pipe' } );

}

// =============================================================================================== the panels, built by their own code
const i18n = await import( '../src/i18n/index.js' );
const { default: en } = await import( '../src/i18n/en.js' );
const { default: ro } = await import( '../src/i18n/ro.js' );

// the runtime's translation of a built panel (observeDom / translateDom: by value, through tx)
function translateTree( el ) {

	for ( const c of el.children ) {

		if ( c.text !== undefined ) {

			const s = c.text, trimmed = s.trim();
			if ( ! trimmed ) continue;
			const out = i18n.tx( trimmed );
			if ( out !== trimmed ) c.text = s.replace( trimmed, () => out );

		} else {

			for ( const k of [ 'title', 'aria-label', 'data-tip' ] ) if ( c.attrs[ k ] ) c.attrs[ k ] = i18n.tx( c.attrs[ k ] );
			translateTree( c );

		}

	}

}

const fakeEl = () => {

	const sub = { onclick: null, scrollTop: 0, scrollHeight: 0, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
	return { innerHTML: '', scrollTop: 0, querySelector: () => sub, querySelectorAll: () => [], classList: sub.classList, append() {}, appendChild() {}, isConnected: false };

};

const { Features } = await import( '../src/features/Features.js' );
const { Naval } = await import( '../src/features/naval/Naval.js' );
const crewModule = await import( '../src/features/crew/index.js' );
const { makeRng } = await import( '../src/features/naval/util.js' );
const { GameState } = await import( '../src/game/GameState.js' );
const { Vector3, Quaternion } = await import( '../src/engine/index.js' );
const { GameHUD } = await import( '../src/game/GameHUD.js' );
const { TavernPanel } = await import( '../src/features/harbour/TavernPanel.js' );
const { NavyPanel } = await import( '../src/features/navy/NavyPanel.js' );
const { Navy } = await import( '../src/features/navy/Navy.js' );
const { forecastText } = await import( '../src/features/weather/Fronts.js' );
const { PAGES, pageHTML } = await import( '../src/game/Guide.js' );
const { HAIL } = await import( '../src/features/navy/NavyData.js' );

function world( { touch = false } = {} ) {

	const state = new GameState( store() );
	state.boat = 'brigantine';
	state.unlocked = [ 'hyptile', 'pepe', 'doge', 'pengu', 'bonk', 'bravile', 'heptyle' ];
	state.character = 'hyptile';
	state.money = 4820;
	const toasts = [];
	const app = {
		mode: 'campaign', settings: { timeOfDay: 12 }, terrainData: { heightAt: () => - 12 }, scene: null,
		boatCtl: { position: new Vector3( 0, 0, 1500 ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), driven: true, moored: false, speed: 0, enabled: true },
		camera: { position: new Vector3( 0, 4, 1490 ), quaternion: new Quaternion() },
		player: { mode: 'walk', position: new Vector3( 0, 1, 1500 ) },
		input: { hit: () => false, down: () => false, enabled: true },
		game: { state, hour: 10, toast( t ) { toasts.push( t ); }, contracts: { onCatch() {}, active: [] } },
	};
	const features = new Features( app );
	app.features = features;
	features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 5, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const crew = features.add( 'crew', { install: ( a, f ) => crewModule.install( a, f, { rng: makeRng( 9 ), deck: false, doc: null } ) } );
	// two tavern hands signed on, one roster hand posted
	for ( const s of crew.hireables( 'tidemark' ).slice( 0, 2 ) ) crew.hire( s.id, 'tidemark' );
	crew.setPost( 'pepe', 'gunner' );
	crew.setPost( 'doge', 'angler' );
	const ui = { root: { classList: { contains: ( c ) => touch && ( c === 'is-touch' || c === 'is-coarse' ), add() {}, remove() {}, toggle() {} }, append() {} } };
	const hud = Object.create( GameHUD.prototype );
	Object.assign( hud, { ui, game: { ...app.game, app, chandlerDiscount: () => 0, toast() {} }, stand: fakeEl(), inv: fakeEl(), roster: fakeEl(), _last: {} } );
	return { app, state, crew, hud, toasts };

}

// every panel of the audit: builds its HTML now (in the current language)
export const PANELS = {
	crewTab: ( W ) => {

		W.hud.vendor = { kind: 'shop', name: 'Ethena Prosper', greeting: 'What do you need?' };
		W.hud.shopTab = 'crew';
		W.hud.renderShop();
		return { cls: 'gm-panel', host: 'root', html: W.hud.stand.innerHTML };

	},
	roster: ( W ) => {

		W.hud.rosterOpen = true;
		W.hud.renderRoster();
		return { cls: 'gm-panel', host: 'root', html: W.hud.roster.innerHTML };

	},
	gearTab: ( W ) => {

		W.hud.vendor = { kind: 'shop', name: 'Ethena Prosper', greeting: 'What do you need?' };
		W.hud.shopTab = 'gear';
		W.hud.renderShop();
		return { cls: 'gm-panel', host: 'root', html: W.hud.stand.innerHTML };

	},
	yard: ( W ) => {

		W.hud.vendor = { kind: 'yard', name: 'Captain Roid · Boat yard', greeting: 'Click click. Boats, guns, repairs.' };
		W.hud.yardTab = 'yard';
		W.hud.renderYard();
		return { cls: 'gm-panel', host: 'root', html: W.hud.stand.innerHTML };

	},
	stand: ( W ) => {

		W.state.inventory = [ { id: 1, species: Object.keys( W.state.log || {} )[ 0 ] || 'mackerel', kg: 1.42, value: 18 } ].filter( () => false );
		W.hud.vendor = { kind: 'stand', name: 'PoorGoat', greeting: 'Let\'s see what you caught.' };
		W.hud.standTab = 'sell';
		W.hud.renderStand();
		return { cls: 'gm-panel', host: 'root', html: W.hud.stand.innerHTML };

	},
	cooler: ( W ) => {

		W.hud._invView = 'list';
		W.hud.renderInventory();
		return { cls: 'gm-panel', host: 'root', html: W.hud.inv.innerHTML };

	},
	tavernHands: ( W ) => tavern( W, 'hands' ),
	tavernMenu: ( W ) => tavern( W, 'menu' ),
	navyOffice: ( W ) => navy( W, 'office' ),
	navyPress: ( W ) => navy( W, 'press' ),
	guideNavy: () => guide( 'navy' ),
	guideFronts: () => guide( 'fronts' ),
	guideAshore: () => guide( 'ashore' ),
	guideCrew: () => guide( 'crew' ),
	toastNavy: () => toast( `${ HAIL.board( 'HMS Resolute' ) }: a fine of $460 you cannot pay: settle it at the navy office` ),
	toastFront: () => toast( `Radio: ${ forecastText( 0, 0, 0.2, { speed: 0.01 } ).replace( 'No fronts on the glass: fair sailing for now.', 'A squall line from the south-west, about 25 minutes out: gusts to 35 knots and rain, then clearing.' ) }` ),
	toastCrew: () => toast( 'Ada Kell signs on for $185 and $9 a day: post them from the crew list' ),
};

function tavern( W, tab ) {

	const harbour = {
		app: null, hour: 20.5, tavern: { buffs: [], left: () => 0, dice: { lastRound: null, tally: { rounds: 0, wins: 0, losses: 0, draws: 0 }, ready: () => true }, heard: [] },
		features: { state: W.state, get: ( n ) => ( n === 'crew' ? W.crew : null ) }, residentName: () => 'Molly Tanner',
	};
	const p = new TavernPanel( harbour );
	p.site = { name: 'The Tide & Tankard', port: 'tidemark', keeper: 'molly' };
	p.tab = tab;
	return { cls: 'hb-panel', host: 'hud', html: p.render(), translate: translateTree };

}

function navy( W, mode ) {

	const stub = { standing: 30, sandbox: false, naval: null, get: () => null, _moduleRow: () => ( { tier: 0, maxTier: 2, price: 900, canBuy: true } ) };
	const rows = Navy.prototype.chandlerRows.call( stub );
	const n = {
		app: null, press: mode === 'press' ? { port: 'tidemark', fine: 150 } : null,
		view: () => ( { standing: 30, standingName: 'Friend of the fleet', wanted: false, owed: 1140, owedCount: 3, fineOwed: 460,
			forecast: 'A squall line from the south-west, about 25 minutes out: gusts to 35 knots and rain, then clearing.' } ),
		chandlerRows: () => rows,
	};
	const p = new NavyPanel( n );
	p.mode = mode;
	p.el = { innerHTML: '' };
	p.render();
	return { cls: 'nv-panel', host: 'hud', html: p.el.innerHTML, translate: translateTree };

}

function guide( id ) {

	const page = PAGES.find( ( p ) => p.id === id );
	if ( ! page ) return null;
	const html = `<div class="gm-guide-eyebrow">${ i18n.t( `guide.${ id }.eyebrow` ) }</div><h2>${ i18n.t( `guide.${ id }.title` ) }</h2>
		<div class="gm-guide-body">${ pageHTML( page ) }</div>
		<div class="gm-guide-foot"><div class="gm-guide-dots"><span class="is-on"></span><span></span><span></span></div><div class="gm-guide-btns"><span class="gm-guide-hint">Esc</span><button class="gm-btn is-ghost">${ i18n.t( 'guide.skip' ) }</button><button class="gm-btn">${ i18n.t( 'guide.next' ) }</button></div></div>`;
	return { cls: 'gm-guide-card', host: 'hud', html, wrap: '<div class="gm-guide is-on"></div>', centre: true };

}

function toast( text ) {

	const tt = i18n.tx( text );
	return { cls: 'tw-toasts', host: 'hud', glass: false, html: `<div class="tw-toast tw-glass is-in"><span class="tw-toast-dot"></span><span class="tw-toast-text">${ tt.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ) }</span></div>` };

}

// =============================================================================================== the audit run
export function runAudit( { only = null, shots = null, langs = [ 'en' ] } = {} ) {

	loadRules();
	const results = [];
	const bg = join( ROOT, 'tools/visuals/out/after/medium-tidemarkNoon.png' );
	for ( const lang of langs ) {

		i18n.setLang( lang, { persist: false } );
		for ( const size of SIZES ) {

			const W = world( { touch: size.touch } );
			for ( const [ id, build ] of Object.entries( PANELS ) ) {

				if ( only && ! only.includes( id ) ) continue;
				const p = build( W );
				if ( ! p ) continue;
				const a = audit( p, size, lang );
				a.id = id;
				results.push( a );
				if ( shots ) drawShot( a, join( shots, `${ id }-${ size.id }-${ lang }.png` ), bg, `${ id } ${ size.W }x${ size.H }${ size.touch ? ' touch' : '' } ${ lang } · ${ a.issues.length } issue(s)` );

			}

		}

	}

	i18n.setLang( 'en', { persist: false } );
	return results;

}

const summarise = ( i ) => `${ i.type }${ i.by ? ` by ${ Math.round( i.by ) } px` : '' }${ i.w !== undefined && i.type === 'tap' ? ` ${ i.w }x${ i.h }` : '' } at ${ i.at }${ i.text ? ` "${ i.text }"` : '' }${ i.why ? ` (${ i.why })` : '' }`;

if ( ! process.env.UI_W20_LIB ) {

	const shots = arg( 'shots' );
	const only = arg( 'only' ) ? String( arg( 'only' ) ).split( ',' ) : null;
	const results = runAudit( { only, shots: typeof shots === 'string' ? resolve( shots ) : null } );
	if ( arg( 'report' ) ) for ( const a of results ) for ( const i of a.issues ) console.log( `  ${ a.id } ${ a.size.id } ${ a.lang }: ${ summarise( i ) }` );
	const by = ( type ) => results.flatMap( ( a ) => a.issues.filter( ( i ) => i.type === type ).map( ( i ) => `${ a.id }/${ a.size.id }/${ a.lang }: ${ summarise( i ) }` ) );
	console.log( `audited ${ results.length } panel views (${ Object.keys( PANELS ).length } panels x ${ SIZES.length } sizes)` );
	const show = ( list ) => list.slice( 0, 4 ).join( ' | ' );
	const over = by( 'overflow' ), clipY = by( 'clipped-y' ), off = by( 'off-screen' ), tap = by( 'tap' );
	ok( over.length === 0, `nothing wider than its box (${ over.length }) ${ show( over ) }` );
	ok( clipY.length === 0 && off.length === 0, `every panel fits the screen or scrolls (${ clipY.length + off.length }) ${ show( [ ...clipY, ...off ] ) }` );
	ok( tap.length === 0, `tap targets >= 44 px on touch (${ tap.length }) ${ show( tap ) }` );
	const cut = results.filter( ( a ) => a.panel.cls === 'tw-toasts' ).flatMap( ( a ) => a.issues.filter( ( i ) => i.type === 'truncated' ).map( ( i ) => `${ a.id }/${ a.size.id }/${ a.lang }: ${ summarise( i ) }` ) );
	ok( cut.length === 0, `long toasts (the forecast, the navy, the crew) are read whole, never cut (${ cut.length }) ${ show( cut ) }` );
	ok( results.some( ( a ) => a.id === 'guideNavy' ) && results.some( ( a ) => a.id === 'guideAshore' ), 'the new guide pages are audited too' );

	// ---- English only (user, 2026-10-15): a saved Romanian choice and a Romanian browser still start in English
	{

		const ls = store();
		ls.setItem( i18n.STORAGE_KEY, 'ro' );
		const keepLS = globalThis.localStorage;
		globalThis.localStorage = ls;
		Object.defineProperty( globalThis, 'navigator', { value: { language: 'ro-RO' }, configurable: true, writable: true } );
		const fresh = await import( '../src/i18n/index.js?englishOnly' );
		ok( fresh.getLang() === 'en', 'a saved "ro" and a Romanian browser: the game starts in English' );
		ok( fresh.OFFERED.length === 1 && fresh.OFFERED[ 0 ] === 'en', 'English is the only language offered' );
		globalThis.localStorage = keepLS;
		// the settings' Access tab: no Language folder while one language is offered
		const A = await import( '../src/ui/Accessibility.js' );
		const acc = new A.Accessibility( { storage: store(), doc: null } );
		const folders = [];
		const any = () => new Proxy( function () {}, { get: () => any(), apply: () => any() } );
		const tab = { addFolder: ( name ) => { folders.push( name ); return any(); } };
		acc.ui = { refresh() {} };
		try { acc._buildAccess( tab ); } catch ( e ) { folders.push( 'threw ' + e.message ); }
		ok( folders.length > 1 && ! folders.includes( 'Language' ), `no language picker in the settings (${ folders.join( ', ' ) })` );

	}

	// ---- call sites: every t( 'key', 'English' ) of the files I own matches en.js where the key is there
	{

		let calls = 0;
		const bad = [];
		for ( const f of [ 'src/game/HudPanels.js', 'src/game/GameHUD.js', 'src/ui/TouchControls.js', 'src/game/Tips.js', 'src/game/Guide.js' ] ) {

			const src = read( f );
			const re = /\bt\(\s*'([\w.]+)'\s*,\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
			let m;
			while ( ( m = re.exec( src ) ) ) {

				calls ++;
				const fb = m[ 2 ].slice( 1, - 1 ).replace( /\\'/g, "'" );
				if ( m[ 1 ] in en && en[ m[ 1 ] ] !== fb ) bad.push( `${ f }: ${ m[ 1 ] } "${ fb }" vs "${ en[ m[ 1 ] ] }"` );

			}

		}

		ok( calls > 150 && bad.length === 0, `${ calls } t() call sites agree with en.js ${ bad.slice( 0, 3 ).join( ' | ' ) }` );
		const hp = read( 'src/game/HudPanels.js' ) + read( 'src/game/GameHUD.js' );
		ok( ! /Leave \(E\)|Close \([IK]\)|Z fires to port/.test( hp ), 'no hard-coded key glyphs left in the HUD panels' );

	}

	// ---- key glyphs follow touch
	{

		const { leaveLabel, closeLabel, touchOn } = await import( '../src/game/HudPanels.js' );
		const hud = ( touch ) => ( { ui: { root: { classList: { contains: ( c ) => touch && c === 'is-touch' } } }, game: { app: { accessibility: { keyHint: ( k ) => ( k === 'E' ? 'F' : k ) } } } } );
		ok( leaveLabel( hud( false ) ) === 'Leave (F)' && leaveLabel( hud( true ) ) === 'Leave', 'Leave names the bound key on a keyboard, no key on touch' );
		ok( closeLabel( hud( false ), 'K' ) === 'Close (K)' && closeLabel( hud( true ), 'K' ) === 'Close' && touchOn( hud( true ) ), 'Close (K) on a keyboard, Close on touch' );
		const W = world( { touch: true } );
		W.state.money = 99999;
		W.hud.vendor = { kind: 'yard', name: 'Captain Roid', greeting: '' };
		W.hud.yardTab = 'yard';
		W.hud.renderYard();
		const touchYard = W.hud.stand.innerHTML;
		ok( ! /Leave \(E\)/.test( touchYard ) && ! /Z fires|fires to port/.test( touchYard ) && /Leave</.test( touchYard ), 'the yard on touch: Leave without E, the broadside row without Z / X (and it renders: the hijack row no longer throws)' );

	}

	// ---- touch: the hail's answer and the shot at the helm (contextual, never standing)
	{

		const TC = await import( '../src/ui/TouchControls.js' );
		const { hailButtons, nextShot, HAIL_MS, TouchControls } = TC;
		ok( [ ...hailButtons( { mode: 'boat', hail: true } ) ].join() === 'heave,run', 'a hail at the helm: Heave to and Run' );
		ok( hailButtons( { mode: 'walk', hail: true } ).size === 0 && hailButtons( { mode: 'boat', hail: true, busy: true } ).size === 0 && hailButtons( { mode: 'boat' } ).size === 0, 'no hail, ashore or a panel open: nothing' );
		ok( hailButtons( { mode: 'boat', guns: true, shot: { sel: 'round', kinds: [ 'round', 'chain' ] } } ).has( 'shot' ) && ! hailButtons( { mode: 'boat', guns: true, shot: { sel: 'round', kinds: [ 'round' ] } } ).has( 'shot' ), 'Shot only with chain / grape aboard' );
		ok( nextShot( 'round', [ 'round', 'chain', 'grape' ] ) === 'chain' && nextShot( 'grape', [ 'round', 'chain', 'grape' ] ) === 'round' && nextShot( 'round', [ 'round', 'grape' ] ) === 'grape', 'Shot loads the next kind aboard, round again after the last' );
		const listeners = {};
		const o = Object.create( TouchControls.prototype );
		Object.assign( o, { app: { features: { on: ( n, fn ) => { listeners[ n ] = fn; return () => {}; }, get: ( n ) => ( n === 'weapons' ? { shot: { chain: 4, grape: 0 }, shotSel: 'chain', sandbox: false } : null ) } }, _throttle: 0.7 } );
		o._paintLever = () => {};
		o._sync = () => {};
		ok( o._hailOn() === false && typeof listeners.navyHail === 'function', 'it listens for the navy\'s hails' );
		listeners.navyHail( { say: 'hail', ship: 'HMS Resolute' } );
		ok( o._hailOn() === true, 'a hail: the answer buttons come up' );
		o.answerHail( 'heave' );
		ok( o._throttle === 0 && o._hailOn() === false, 'Heave to: the lever to stop, the buttons go' );
		listeners.navyHail( { say: 'warn' } );
		o.answerHail( 'run' );
		ok( o._throttle === 1, 'Run: full ahead' );
		listeners.navyHail( { say: 'hail' } );
		listeners.navyHail( { say: 'fire' } );
		ok( o._hailOn() === false, 'fired on: the question is answered' );
		listeners.navyHail( { say: 'hail' } );
		o._hail.t -= HAIL_MS + 1;
		ok( o._hailOn() === false, `unanswered for ${ HAIL_MS / 1000 } s: gone` );
		const sh = o._shotState();
		ok( sh && sh.sel === 'chain' && sh.kinds.join() === 'round,chain', 'the shot state reads the weapons locker' );

	}

	// ---- the one-time tips of wave 19's systems
	{

		const { Tips, TIPS, FRONT_SOON } = await import( '../src/game/Tips.js' );
		ok( [ 'crew', 'navy', 'front', 'inside' ].every( ( id ) => TIPS[ id ] && TIPS[ id ].text in en ), 'crew, navy, front and inside tips, in en.js' );
		const listeners = {};
		const said = [];
		const forecast = { inHours: FRONT_SOON + 1, under: false };
		const features = { on: ( n, fn ) => { listeners[ n ] = fn; return () => {}; }, get: ( n ) => ( n === 'weather' ? { seaForecast: () => forecast } : null ) };
		const app = { player: { mode: 'boat', position: { x: 4000, z: 4000 } }, game: { guide: { say: ( id, html ) => said.push( { id, html } ) } }, ui: { touch: { active: true } } };
		const tp = new Tips( app, features );
		listeners.crewHired( { id: 'x' } );
		listeners.navyHail( { say: 'hail' } );
		listeners.interiorEntered( { id: 'tidemark.tavern' } );
		tp.update( 1 );
		ok( tp.seen.has( 'crew' ) && tp.seen.has( 'navy' ) && tp.seen.has( 'inside' ) && ! tp.seen.has( 'front' ), 'a hand signs on, a hail, a room: one tip each; the front is still far' );
		forecast.inHours = FRONT_SOON - 0.2;
		tp.update( 1 );
		ok( tp.seen.has( 'front' ), 'a squall line under 1.5 island hours away: the front tip' );
		const navyHtml = said.find( ( x ) => x.id === 'tips.navy' ).html;
		ok( /<b>Heave to<\/b>/.test( navyHtml ) && ! /<kbd>/.test( navyHtml ), 'on touch the navy tip names the Heave to button' );
		ok( /<kbd>/.test( tp.html( 'navy', false ) ) && /<kbd>/.test( tp.html( 'inside', false ) ), 'on a keyboard: key caps' );
		listeners.navyHail( { say: 'hail' } );
		ok( said.filter( ( x ) => x.id === 'tips.navy' ).length === 1, 'once per save' );

	}

	// ---- the guide's new pages
	{

		const { MAX_LINES, pageKeys } = await import( '../src/game/Guide.js' );
		const ids = PAGES.map( ( p ) => p.id );
		ok( [ 'navy', 'fronts', 'ashore' ].every( ( id ) => ids.includes( id ) ) && ids[ ids.length - 1 ] === 'multi', 'the guide has the navy, storm front and walk-in town pages (multiplayer still last)' );
		const fresh = PAGES.filter( ( p ) => [ 'navy', 'fronts', 'ashore', 'crew' ].includes( p.id ) );
		ok( fresh.every( ( p ) => p.lines.length <= MAX_LINES && pageKeys( p ).every( ( k ) => k in en ) ), 'every new page line is in en.js, five lines a page at most' );
		ok( fresh.flatMap( ( p ) => p.lines.map( ( l, i ) => en[ `guide.${ p.id }.${ i + 1 }` ] ) ).every( ( x ) => x && x.length <= 110 ), 'every new line is short (110 characters at most)' );
		ok( pageHTML( PAGES.find( ( p ) => p.id === 'navy' ), { touch: true } ).includes( 'Heave to' ), 'on touch the navy page names the Heave to button' );

	}

	console.log( `\n${ passes } passed, ${ fails } failed` );
	process.exit( fails ? 1 : 0 );

}

export { fails, passes, ok };
