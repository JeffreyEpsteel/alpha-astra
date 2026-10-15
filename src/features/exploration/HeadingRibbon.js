// The heading ribbon (docs/UNREAL_PARITY.md W16, V16): a thin compass strip at the top of the screen while afloat, in
// the HUD's glass style and faint: the view's heading under a centre tick, the cardinal points sliding past, small
// marks for the ports (their initial), the bow of your boat and where the wind comes from. Gone on land.
// North is -z (the home island lies north of the bay).
//
//   headingOf( dx, dz ) -> degrees 0..360 (0 north, 90 east)       wrapDelta( a, b ) -> b - a in -180..180
//   ribbonMarks( heading, items, span ) -> [ { id, label, kind, offset: -0.5..0.5 } ] the items inside the strip (pure)
//   const r = new HeadingRibbon( app, features );  r.update( dt )  r.visible  r.heading  r.marks

import { WORLD } from '../../world/WorldLayout.js';
import { G } from '../../core/Globals.js';

export const SPAN = 120; // degrees across the strip
const ABOARD = new Set( [ 'boat', 'deck', 'seat', 'ride' ] );
const CARD = [ 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW' ];

const CSS = /* css */`
.hr-root { position: fixed; left: 50%; top: calc(10 * var(--tw-u, 1px)); width: min(420px, 60vw); height: 26px; transform: translateX(-50%); pointer-events: none; z-index: 4;
	overflow: hidden; opacity: 0; transition: opacity 600ms ease; -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.hr-root.is-on { opacity: 0.72; }
.hr-strip { position: absolute; left: 0; top: 0; height: 100%; will-change: transform; }
.hr-t { position: absolute; bottom: 4px; width: 1px; height: 5px; background: rgba(233,241,247,0.55); }
.hr-t.is-major { height: 8px; background: rgba(233,241,247,0.8); }
.hr-c { position: absolute; top: 0; transform: translateX(-50%); font: 600 10px/1 var(--tw-mono, monospace); color: rgba(233,241,247,0.85); letter-spacing: 0.06em; }
.hr-mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(var(--tw-aqua-rgb, 120,220,230), 0.9); }
.hr-deg { position: absolute; left: 50%; bottom: -1px; transform: translateX(-50%); font: 500 9px/1 var(--tw-mono, monospace); color: rgba(var(--tw-aqua-rgb, 120,220,230), 0.95); }
.hr-m { position: absolute; top: 11px; transform: translateX(-50%); font: 600 9px/1 var(--tw-mono, monospace); color: #ffe08a; }
.hr-m.k-bow { color: rgba(233,241,247,0.9); } .hr-m.k-wind { color: rgba(170,210,255,0.9); }
`;

export function headingOf( dx, dz ) {

	const h = Math.atan2( dx, - dz ) * 180 / Math.PI;
	return ( h + 360 ) % 360;

}

export function wrapDelta( a, b ) {

	return ( ( b - a ) % 360 + 540 ) % 360 - 180;

}

// items: [ { id, label, kind, deg } ]; offset is the fraction of the strip from its centre
export function ribbonMarks( heading, items, span = SPAN ) {

	const out = [];
	for ( const it of items ) {

		const d = wrapDelta( heading, it.deg );
		if ( Math.abs( d ) > span / 2 ) continue;
		out.push( { id: it.id, label: it.label, kind: it.kind, offset: d / span } );

	}

	return out;

}

export class HeadingRibbon {

	constructor( app, features ) {

		this.app = app;
		this.features = features || null;
		this.visible = false;
		this.heading = 0;
		this.marks = [];
		this.el = null;
		this._pxPerDeg = 0;
		this._acc = 0;

	}

	afloat() {

		const app = this.app || {}, p = app.player;
		return !! ( p && ABOARD.has( p.mode ) && ! app.freeCam );

	}

	// the view heading, and the marks: ports, the bow, the wind's origin
	compute() {

		const app = this.app || {}, cam = app.camera;
		if ( ! cam || ! cam.matrixWorld ) return null;
		cam.updateMatrixWorld && cam.updateMatrixWorld();
		const e = cam.matrixWorld.elements;
		this.heading = headingOf( - e[ 8 ], - e[ 10 ] );
		const cp = cam.position, items = [];
		for ( const p of WORLD.ports || [] ) {

			const q = p.stand || ( p.dock && p.dock.position ) || p.center;
			if ( ! q ) continue;
			const d = Math.hypot( q.x - cp.x, q.z - cp.z );
			if ( d < 40 ) continue;
			items.push( { id: 'port-' + p.id, label: ( p.name || p.id ).charAt( 0 ).toUpperCase(), kind: 'port', deg: headingOf( q.x - cp.x, q.z - cp.z ) } );

		}

		const b = app.boatCtl;
		if ( b && b.quaternion && b.position ) {

			// the bow is the hull's local +z (BoatController.forward)
			const q = b.quaternion;
			const fx = 2 * ( q.x * q.z + q.w * q.y ), fz = 1 - 2 * ( q.x * q.x + q.y * q.y );
			items.push( { id: 'bow', label: '▲', kind: 'bow', deg: headingOf( fx, fz ) } );

		}

		const wd = G && G.windDir && G.windDir.value;
		if ( wd && Number.isFinite( wd.x ) ) items.push( { id: 'wind', label: '≈', kind: 'wind', deg: headingOf( - wd.x, - wd.y ) } );
		this.marks = ribbonMarks( this.heading, items );
		return this.heading;

	}

	_dom() {

		if ( this.el || typeof document === 'undefined' || ! document.createElement ) return this.el;
		try {

			if ( ! document.getElementById( 'hr-style' ) ) {

				const st = document.createElement( 'style' );
				st.id = 'hr-style';
				st.textContent = CSS;
				document.head.append( st );

			}

			const el = document.createElement( 'div' );
			el.className = 'hr-root';
			el.innerHTML = '<div class="hr-strip"></div><div class="hr-marks"></div><div class="hr-mid"></div><div class="hr-deg"></div>';
			( document.querySelector && document.querySelector( '.tw-root' ) || document.body ).append( el );
			this.el = el;
			this._strip = el.querySelector( '.hr-strip' );
			this._marksEl = el.querySelector( '.hr-marks' );
			this._deg = el.querySelector( '.hr-deg' );

		} catch ( e ) { this.el = null; }

		return this.el;

	}

	// ticks every 15 degrees over -360 .. 720 so the strip can slide without wrapping
	_layout() {

		const w = this.el.clientWidth || 420;
		this._pxPerDeg = w / SPAN;
		const k = this._pxPerDeg;
		let html = '';
		for ( let d = - 360; d <= 720; d += 15 ) {

			const x = ( d + 360 ) * k;
			const n = ( ( d % 360 ) + 360 ) % 360;
			const major = n % 45 === 0;
			html += `<div class="hr-t${ major ? ' is-major' : '' }" style="left:${ x.toFixed( 1 ) }px"></div>`;
			if ( major ) html += `<div class="hr-c" style="left:${ x.toFixed( 1 ) }px">${ CARD[ n / 45 ] }</div>`;

		}

		this._strip.innerHTML = html;
		this._w = w;

	}

	update( dt ) {

		const on = this.afloat();
		if ( on !== this.visible ) {

			this.visible = on;
			const el = this._dom();
			if ( el ) el.classList.toggle( 'is-on', on );

		}

		if ( ! on ) return;
		this._acc += dt;
		if ( this.compute() === null ) return;
		const el = this._dom();
		if ( ! el ) return;
		if ( ! this._pxPerDeg || ( el.clientWidth && el.clientWidth !== this._w ) ) this._layout();
		const k = this._pxPerDeg, w = this._w;
		this._strip.style.transform = `translateX(${ ( w / 2 - ( this.heading + 360 ) * k ).toFixed( 1 ) }px)`;
		if ( this._deg ) this._deg.textContent = String( Math.round( this.heading ) % 360 ).padStart( 3, '0' );
		// the marks change slowly: four times a second is plenty
		if ( this._acc < 0.25 ) return;
		this._acc = 0;
		this._marksEl.innerHTML = this.marks.map( ( m ) => `<div class="hr-m k-${ m.kind }" style="left:${ ( 50 + m.offset * 100 ).toFixed( 2 ) }%">${ m.label }</div>` ).join( '' );

	}

	dispose() {

		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

}
