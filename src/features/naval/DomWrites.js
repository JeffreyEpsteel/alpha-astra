// HUD DOM writes only on a change (wave 12D). The naval HUD set ~30 inline styles and 8 texts a frame, nearly all to the
// value they already had (a same-value textContent still replaces the text node and relayouts; a same-value style write
// is skipped by the browser but its string was built for nothing). The last written value is kept on the element, so
// these must be the only writers of that property; numbers are compared after rounding, before any string is built.
//   setText( el, text )   setStyle( el, prop, value )   setNum( el, prop, x, digits, pre, post )   setClass( el, className )

export function setText( el, v ) {

	if ( el._dwText === v ) return;
	el._dwText = v;
	el.textContent = v;

}

export function setStyle( el, prop, v ) {

	const c = el._dwStyle || ( el._dwStyle = {} );
	if ( c[ prop ] === v ) return;
	c[ prop ] = v;
	el.style[ prop ] = v;

}

// el.style[ prop ] = pre + x.toFixed( digits ) + post, built only when the rounded value moved
export function setNum( el, prop, x, digits, pre, post ) {

	const q = Math.round( x * 10 ** digits );
	const c = el._dwNum || ( el._dwNum = {} );
	if ( c[ prop ] === q ) return;
	c[ prop ] = q;
	el.style[ prop ] = pre + x.toFixed( digits ) + post;

}

export function setClass( el, v ) {

	if ( el._dwClass === v ) return;
	el._dwClass = v;
	el.className = v;

}
