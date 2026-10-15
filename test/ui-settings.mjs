// Plain-node test of the settings panel's tab strip maths (core/Touch.js tabStripLayout, used by ui/UI.js _layoutTabs).
// The CSS does the wrapping (flex-wrap, no scroll); this decides whether the active tab's name still fits.
// jsdom is not installed, so the DOM side is covered by reading ui.css for the structure rules.

import { readFileSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const { tabStripLayout } = await import( '../src/core/Touch.js' );

// 9 tabs (settings sections), the panel's strip about 330 px wide on desktop, ~300 on a narrow phone
let l = tabStripLayout( 330, 9, { activeIndex: 0 } );
ok( l.perRow === 7 && l.rows === 2, '330 px, 9 tabs: 7 chips per row, 2 rows' );
l = tabStripLayout( 330, 9, { activeIndex: 8 } );
ok( l.rows >= 2 && l.rows <= 3, 'the last tab active (Performance): still every chip placed' );
l = tabStripLayout( 900, 9 );
ok( l.rows === 1 && l.labels, 'a wide strip: one row, the active name shows' );
l = tabStripLayout( 120, 9, { activeIndex: 3 } );
ok( l.perRow === 2 && l.rows === 5 && ! l.labels, 'a tiny strip: 2 per row, 5 rows, no label (it would add a row)' );
l = tabStripLayout( 0, 4 );
ok( l.perRow === 1 && l.rows === 4, 'no width yet: one chip per row, nothing divides by zero' );
l = tabStripLayout( 300, 0 );
ok( l.rows === 0 && ! l.labels, 'no tabs: no rows' );
l = tabStripLayout( 300, 5, { activeIndex: - 1 } );
ok( ! l.labels && l.rows === 1, 'no active tab: no label' );

// every tab always gets a place: rows * perRow covers the count at any width
let all = true;
for ( let w = 40; w <= 1200; w += 17 ) for ( let n = 1; n <= 14; n ++ ) {

	const r = tabStripLayout( w, n, { activeIndex: n - 1 } );
	if ( r.rows * r.perRow < n && ! r.labels ) all = false;
	if ( r.rows < 1 || r.perRow < 1 ) all = false;

}

ok( all, 'any width, any tab count: every tab has a chip slot' );

// structure rules in the stylesheet: wrap, no scrolling strip, one scrolling region, fixed on touch
const css = readFileSync( new URL( '../src/ui/ui.css', import.meta.url ), 'utf8' );
const rule = ( sel ) => {

	const i = css.indexOf( '\n' + sel + ' {' );
	return i < 0 ? '' : css.slice( i, css.indexOf( '}', i ) );

};
ok( /flex-wrap:\s*wrap/.test( rule( '.tw-tabs' ) ) && ! /overflow-x:\s*auto/.test( rule( '.tw-tabs' ) ), '.tw-tabs wraps and does not scroll' );
ok( ! /\.tw-tabs\s*\{[^}]*position:\s*sticky/.test( css ), 'no sticky tab strip any more' );
ok( /flex:\s*1 1 auto/.test( rule( '.tw-pages' ) ) && /min-height:\s*0/.test( rule( '.tw-pages' ) ) && /overflow-y:\s*auto/.test( rule( '.tw-pages' ) ) && /overscroll-behavior:\s*contain/.test( rule( '.tw-pages' ) ), '.tw-pages is the one scroller (flex 1 1 auto, min-height 0, contained)' );
ok( /position:\s*fixed/.test( rule( '.tw-root.is-touch .tw-panel' ) ) && /100dvh/.test( rule( '.tw-root.is-touch .tw-panel' ) ), 'touch: the panel is fixed with a dvh-based height' );

// the touch fold and the collapsed top-right row (wave 10E): structure rules in the stylesheet
ok( /display:\s*none/.test( rule( '.tc-top-items' ) ) && /\.tc-top\.is-open \.tc-top-items/.test( css ) && /\.tc-root\.is-busy \.tc-top-items/.test( css ), 'touch: the top row is folded behind a toggle, opened by .is-open, and still shown while a panel is up (Menu)' );
ok( /height:\s*44px/.test( rule( '.tc-fold' ) ) && /touch-action:\s*none/.test( rule( '.tc-fold' ) ), 'touch: the fold handle is 44 px tall and takes drags' );
ok( /visibility:\s*hidden/.test( rule( '.tc-tray:not(.is-open)' ) ), 'touch: a closed tray shows nothing' );
ok( /\.tc-root\.is-busy \.tc-fold/.test( css ) && /\.tc-root\.is-photo \.tc-fold/.test( css ), 'touch: no handle behind a panel or in photo mode' );
ok( /max-height:\s*420px\)\s*and\s*\(orientation:\s*landscape\)/.test( css ) && /\.tw-brand-name\s*\{\s*display:\s*none/.test( css.slice( css.indexOf( 'orientation: landscape' ) ) ), 'phones in short landscape: the title chip goes, the mode chip stays' );
ok( /\.tw-root\.is-touch \.tw-rail,/.test( css ), 'the desktop rail stays hidden on touch (the toggle row replaces it)' );

console.log( fails ? `\n${ fails } failed` : '\nall passed' );
process.exit( fails ? 1 : 0 );
