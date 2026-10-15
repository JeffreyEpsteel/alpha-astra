import { WORLD } from '../world/WorldLayout.js';
import { terrainTiles } from '../world/terrain/TerrainTiles.js';
import { STAND } from './FishStand.js';
import { CHANDLERY } from './Chandlery.js';
import { PONS_STAND } from './PonsPort.js';
import { YARD } from './BoatYard.js';

// Minimap, lower right: the island baked once from the terrain data into a 2D canvas (depth-tinted
// sea, reef and seagrass, sand, grass and forest by height, rock, paths, village pads, the pier,
// hill shading and a coastline), shown in a round window that turns with the view (forward is up,
// a small N on the rim). Markers: the player (centre arrow), PoorGoat's fish stand, Ethena's chandlery
// and the boat; markers beyond the rim sit on it with an arrow. With the fish finder upgrade, a
// couple of soft rings mark the richest water in view.
//
// Per frame it only writes a few CSS transforms. The bake runs in row chunks over the first frames.
//   const map = new Minimap( hudEl, game );  map.update( dt );  map.highlight( [ 'joe', 'marta' ] )
//   map.setWaypoint( { x, z } | null )   the world map's waypoint (a flag; on the rim with an arrow when far)
//   map.addMarker( { id, kind, x, z, label, icon } ) / map.removeMarker( id )   a generic pin (the world map feature
//                                        forwards its markers: the sea chest, the wreck); icon is an ICON name or an svg
//                                        string; the distance from the player shows under it
//   map.baked                            the island bake is finished
//   Wave 13C: the airstrip's plane icon is its own badge kind ('airstrip', shown once Tidemark is discovered: portKnown( game, id )),
//   the world map feature also forwards quest pins ('quest', from the story feature's questPin events) and the parked planes
//   ('parked'); the shared styles cover 'airstrip', 'parked', 'quest' and 'isle' (a charted pirate island) for both maps
//   a tap on it (touch controls on) opens the world map (src/features/worldmap)
//
// Shared with the world map (src/ui/WorldMap.js), so both draw the same chart:
//   ensureMapCSS()   the marker / label styles (.gm-mk badges, .gm-map-label), injected once
//   ICON             the marker icons (svg strings)
//   new TerrainBake( ctx, { n, x0, z0, ppm, jetties, keepHeights } ).step( terrainData, rows ) -> done
//                    the chunked terrain bake into an n x n canvas covering [ x0, x0 + n / ppm ] x [ z0, z0 + n / ppm ]

const N = 640; // baked canvas size (px)
const EXT = 1280; // metres covered by the bake
const X0 = - EXT / 2, Z0 = - 180 - EXT / 2; // world at canvas (0, 0): the island sits north of the bay
const PPM = N / EXT; // canvas px per metre
const ROWS_PER_FRAME = 48;

const CSS = /* css */`
.gm-map { position: absolute; right: var(--tw-edge); bottom: var(--tw-edge); width: calc(184 * var(--tw-u)); height: calc(184 * var(--tw-u));
	border-radius: 50%; padding: calc(5 * var(--tw-u)); pointer-events: none;
	transition: right var(--tw-slow) var(--tw-ease), opacity var(--tw-med) var(--tw-ease); }
.tw-root[data-panel='open'] .gm-map { right: calc(var(--tw-panel-w) + 2 * var(--tw-3)); }
.gm-map-view { position: relative; width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: #0b2c48;
	box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 0 18px rgba(0,0,0,0.45); }
.gm-map-view canvas { position: absolute; left: 0; top: 0; width: ${ N }px; height: ${ N }px; transform-origin: 0 0; image-rendering: auto; }
.gm-map-vig { position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
	background: radial-gradient(circle at 50% 50%, transparent 58%, rgba(4, 12, 20, 0.45) 100%); }
.gm-map-marks { position: absolute; inset: 0; }
.gm-mk { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.gm-mk > i { position: absolute; left: 0; top: 0; display: grid; place-items: center; width: calc(20 * var(--tw-u)); height: calc(20 * var(--tw-u));
	margin: calc(-10 * var(--tw-u)) 0 0 calc(-10 * var(--tw-u)); border-radius: 50%; font: 700 calc(10 * var(--tw-u)) var(--tw-font); font-style: normal;
	color: #0b1418; box-shadow: 0 1px 3px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(255,255,255,0.85); }
.gm-mk > i svg { width: 64%; height: 64%; }
.gm-mk.is-joe > i { background: var(--tw-sun); }
.gm-mk.is-marta > i { background: var(--tw-aqua); }
.gm-mk.is-pons > i { background: var(--tw-sun); }
.gm-mk.is-boat > i { background: #f2efe6; }
.gm-mk.is-wp > i { background: #fff3a8; color: #d8434f; }
.gm-mk.is-death > i, .wm-lg .is-death { background: #f4e2b8; color: #7a2b20; }
.gm-mk.is-wreck > i, .wm-lg .is-wreck { background: #9fbcd0; color: #0b2c48; }
.gm-mk.is-pin > i, .wm-lg .is-pin { background: #f2efe6; }
.gm-mk.is-airstrip > i, .wm-lg .is-airstrip { background: #dfe9ee; color: #0b2c48; }
.gm-mk.is-parked > i, .wm-lg .is-parked { background: #9db2bd; color: #0b1418; }
.gm-mk.is-quest > i, .wm-lg .is-quest { background: #ffd66b; color: #5a3a00; }
.gm-mk.is-isle > i, .wm-lg .is-isle { background: #3b2a2e; color: #ffc2c7; box-shadow: 0 1px 3px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(255,122,133,0.9); }
.gm-map .gm-mk > em { position: absolute; left: 0; top: calc(11 * var(--tw-u)); transform: translateX(-50%); font: 500 calc(9 * var(--tw-u)) var(--tw-mono);
	font-style: normal; color: #fff; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.85); pointer-events: none; }
.gm-map .gm-mk.is-edge > em { display: none; }
.gm-mk > b { position: absolute; left: 0; top: 0; width: 0; height: 0; border-left: calc(5 * var(--tw-u)) solid transparent; border-right: calc(5 * var(--tw-u)) solid transparent;
	border-bottom: calc(7 * var(--tw-u)) solid rgba(255,255,255,0.9); margin: calc(-19 * var(--tw-u)) 0 0 calc(-5 * var(--tw-u)); transform-origin: calc(5 * var(--tw-u)) calc(19 * var(--tw-u)); display: none; }
.gm-mk.is-edge > b { display: block; }
.gm-mk.is-edge > i { transform: scale(0.82); }
.gm-mk.is-hot > i { animation: gm-map-pulse 1.3s var(--tw-ease-io) infinite; }
@keyframes gm-map-pulse { 0%, 100% { box-shadow: 0 1px 3px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(255,255,255,0.85), 0 0 0 0 rgba(255,255,255,0.6); }
	60% { box-shadow: 0 1px 3px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(255,255,255,0.85), 0 0 0 calc(10 * var(--tw-u)) rgba(255,255,255,0); } }
.gm-map-me { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.gm-map-me svg { position: absolute; width: calc(18 * var(--tw-u)); height: calc(18 * var(--tw-u)); left: calc(-9 * var(--tw-u)); top: calc(-10 * var(--tw-u));
	filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.gm-map-n { position: absolute; left: 0; top: 0; width: calc(14 * var(--tw-u)); height: calc(14 * var(--tw-u)); margin: calc(-7 * var(--tw-u)) 0 0 calc(-7 * var(--tw-u));
	border-radius: 50%; display: grid; place-items: center; font: 700 calc(9 * var(--tw-u)) var(--tw-font); color: #0b1418; background: rgba(255,255,255,0.9);
	box-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.gm-map-fish { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; transition: opacity 600ms var(--tw-ease); }
.gm-map-fish.is-on { opacity: 0.9; }
.gm-map-fish > i { position: absolute; left: calc(-12 * var(--tw-u)); top: calc(-12 * var(--tw-u)); width: calc(24 * var(--tw-u)); height: calc(24 * var(--tw-u));
	border-radius: 50%; border: 1.5px solid rgba(var(--tw-aqua-rgb), 0.9); animation: gm-map-ring 2.2s var(--tw-ease-io) infinite; }
.gm-map-fish > i + i { animation-delay: -1.1s; }
@keyframes gm-map-ring { 0% { transform: scale(0.45); } 100% { transform: scale(1.15); border-color: rgba(var(--tw-aqua-rgb), 0); } }
.gm-map-label { position: absolute; left: 50%; bottom: calc(-2 * var(--tw-u)); transform: translate(-50%, 100%); padding-top: calc(4 * var(--tw-u));
	font: 500 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-3); white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.7); display: none; }
/* short windows: the settings rail (right, vertically centred) reaches down to the corner */
@media (max-height: 860px) { .gm-map { right: calc(var(--tw-edge) + 58 * var(--tw-u)); } }
@media (max-width: 640px) { .gm-map { width: calc(128 * var(--tw-u)); height: calc(128 * var(--tw-u)); } }
@media (prefers-reduced-motion: reduce) { .gm-mk.is-hot > i, .gm-map-fish > i { animation: none; } }
`;

let cssInjected = false;

// the marker and label styles, once per page (the minimap and the world map share them)
export function ensureMapCSS() {

	if ( cssInjected || typeof document === 'undefined' ) return;
	cssInjected = true;
	const style = document.createElement( 'style' );
	style.textContent = CSS;
	document.head.append( style );

}

export const ICON = {
	fish: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 4l-2 2 2 2c-2 2-4 4-7 4-4 0-8-2-11-6Zm12-1.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>',
	anchor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M4 14c1 4 4 6 8 6s7-2 8-6"/></svg>',
	boat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v9H6l6-9Zm1 2 5 7h-5V5ZM3 14h18l-3 5H6l-3-5Z"/></svg>',
	// the world map's extra kinds (and the waypoint flag on the minimap)
	flag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h2.2v20H6zM9.4 3H20l-2.6 4.2L20 11.4H9.4z"/></svg>',
	plane: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5c.9 0 1.5 1 1.5 2.2v5.4l7.5 4.3v2.1l-7.5-2.3v4.6l2.3 1.7V21L12 20.1 8.2 21v-1.5l2.3-1.7v-4.6L3 15.5v-2.1l7.5-4.3V3.7c0-1.2.6-2.2 1.5-2.2Z"/></svg>',
	skull: '<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M12 2.5c-4.6 0-8 3.2-8 7.5 0 2.4 1.1 4.4 2.9 5.7v3.1c0 .7.5 1.2 1.2 1.2h1.3v-2.2h1.6V20h2v-2.2h1.6V20h1.3c.7 0 1.2-.5 1.2-1.2v-3.1C18.9 14.4 20 12.4 20 10c0-4.3-3.4-7.5-8-7.5ZM8.7 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6.6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>',
	target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></svg>',
	swords: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 4l11 11M13 17.5l4.5-4.5M15 15l4.5 4.5M20 4 9 15M6.5 13l4.5 4.5M9 15l-4.5 4.5"/></svg>',
	board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="11" rx="1.5"/><path d="M8 14.5V21M16 14.5V21M7.5 7.5h9M7.5 10.5h5.5"/></svg>',
	crate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 9h16v11H4zM4 9l2.2-4.5h11.6L20 9M9.5 13h5"/></svg>',
	helm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="5.5"/><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/></svg>',
	arrow: '<svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" stroke="#0b1418" stroke-width="1.4" stroke-linejoin="round"/></svg>',
	// a quest step's pin (the story feature's questPin): a scroll with an exclamation mark
	quest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 21 12 12 21 3 12Z"/><path d="M12 8v5M12 16.2v.1" stroke-width="2.8"/></svg>',
	// the generic markers (the death feature's sea chest, naval's wrecks)
	chest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3.5 10.5h17V20h-17zM3.5 10.5c0-3.6 2.4-6 5-6h7c2.6 0 5 2.4 5 6M10.5 10.5v3h3v-3"/></svg>',
	wreck: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.2 11.6 19.6 7.4l.8 2.9-1.9 5.7H7.4zM9.3 4.2l1.6-.4 1.6 6.1-1.6.4zM3 19.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1v1.8c-1.5 0-1.5-1-3-1s-1.5 1-3 1-1.5-1-3-1-1.5 1-3 1-1.5-1-3-1-1.5 1-3 1z"/></svg>',
};

// an ICON name or an svg string (anything else: the flag)
export function iconFor( icon ) {

	if ( typeof icon !== 'string' ) return ICON.flag;
	if ( ICON[ icon ] ) return ICON[ icon ];
	return /^\s*<svg[\s>]/.test( icon ) ? icon : ICON.flag;

}

// is this port's island discovered (the sandbox charts everything)? The world map feature answers; else the save's list
export function portKnown( game, id ) {

	const f = game && game.app && game.app.features, wm = f && f.get ? f.get( 'worldmap' ) : null;
	if ( wm && typeof wm.discovered === 'function' ) return !! wm.discovered( id );
	const st = game && game.state;
	return id === 'home' || !! ( st && Array.isArray( st.discovered ) && st.discovered.includes( id ) );

}

const distText = ( m ) => ( m >= 1000 ? `${ ( m / 1000 ).toFixed( m >= 10000 ? 0 : 1 ) } km` : `${ Math.round( m ) } m` );

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

const mix = ( a, b, t ) => [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ];
const sat = ( x ) => Math.min( 1, Math.max( 0, x ) );
const smooth = ( e0, e1, x ) => {

	const t = sat( ( x - e0 ) / ( e1 - e0 ) );
	return t * t * ( 3 - 2 * t );

};

// map palette (sRGB 0..255)
const C = {
	deep: [ 12, 44, 78 ], mid: [ 22, 104, 150 ], shallow: [ 62, 186, 190 ], foam: [ 186, 232, 226 ],
	grassSea: [ 34, 110, 108 ], rubble: [ 30, 84, 104 ],
	sand: [ 232, 216, 172 ], wet: [ 206, 190, 150 ], grass: [ 128, 160, 88 ], scrub: [ 88, 128, 64 ], forest: [ 52, 92, 50 ],
	rock: [ 132, 134, 126 ], path: [ 205, 182, 136 ], scarp: [ 176, 146, 104 ], pad: [ 196, 184, 162 ],
};
export const MAP_COLORS = C;

// The chart: terrain heights and masks baked into an n x n canvas (depth-tinted sea, seabed meadows and
// rubble, sand / grass / forest by height, rock, paths, hill shading, a pale coastline, then the village pads
// and the pier; `jetties` adds the other ports' jetties). step() bakes `rows` rows; the image goes to the
// canvas when the last row is done. `keepHeights` keeps the baked heights (h, n x n) for later lookups.
export class TerrainBake {

	constructor( ctx, { n, x0, z0, ppm, jetties = false, keepHeights = false } ) {

		this.ctx = ctx;
		this.n = n;
		this.x0 = x0;
		this.z0 = z0;
		this.ppm = ppm;
		this.jetties = jetties;
		this.keepHeights = keepHeights;
		this.row = 0;
		this.done = false;
		this.img = ctx.createImageData( n, n );
		this.h = new Float32Array( n * n );

	}

	// baked height at a world point (keepHeights), or null outside / before the bake
	heightAt( x, z ) {

		if ( ! this.done || ! this.h ) return null;
		const px = Math.floor( ( x - this.x0 ) * this.ppm ), py = Math.floor( ( z - this.z0 ) * this.ppm );
		if ( px < 0 || py < 0 || px >= this.n || py >= this.n ) return null;
		return this.h[ py * this.n + px ];

	}

	step( T, rows ) {

		if ( this.done ) return true;
		const N = this.n, X0 = this.x0, Z0 = this.z0, PPM = this.ppm;
		const res = T.res, tex = T.texel, org = T.origin;
		const idx = ( x, z ) => {

			const i = Math.floor( ( x - org ) / tex ), j = Math.floor( ( z - org ) / tex );
			return i < 0 || j < 0 || i >= res || j >= res ? - 1 : j * res + i;

		};

		const d = this.img.data, H = this.h;
		const end = Math.min( N, this.row + rows );
		for ( let py = this.row; py < end; py ++ ) for ( let px = 0; px < N; px ++ ) {

			const x = X0 + ( px + 0.5 ) / PPM, z = Z0 + ( py + 0.5 ) / PPM;
			const hgt = T.heightAt( x, z );
			H[ py * N + px ] = hgt;
			const k = idx( x, z );
			let c;
			if ( hgt < 0 ) {

				const dep = - hgt;
				c = dep < 6 ? mix( C.shallow, C.mid, smooth( 0.3, 6, dep ) ) : mix( C.mid, C.deep, smooth( 6, 40, dep ) );
				if ( k >= 0 ) {

					c = mix( c, C.grassSea, ( T.seagrass[ k ] / 255 ) * 0.55 );
					c = mix( c, C.rubble, ( T.rubble[ k ] / 255 ) * 0.6 );

				}

				c = mix( c, C.foam, smooth( 0.5, 0.0, dep ) * 0.45 );

			} else {

				const rock = k >= 0 ? T.rock[ k ] : 0, sand = k >= 0 ? T.sand[ k ] / 255 : 0;
				c = mix( C.grass, C.scrub, smooth( 4, 16, hgt ) );
				c = mix( c, C.forest, smooth( 12, 40, hgt ) );
				c = mix( c, C.sand, Math.max( sand, smooth( 1.6, 0.4, hgt ) ) );
				c = mix( c, C.wet, smooth( 0.5, 0.0, hgt ) * 0.6 );
				c = mix( c, C.rock, smooth( 0.35, 0.7, rock ) );
				if ( k >= 0 ) {

					c = mix( c, C.path, ( T.path[ k ] / 255 ) * 0.85 );
					c = mix( c, C.scarp, ( T.scarp[ k ] / 255 ) * 0.5 );

				}

				// hill shading, light from the north-west
				const e = 2.5;
				const gx = ( T.heightAt( x + e, z ) - T.heightAt( x - e, z ) ) / ( 2 * e );
				const gz = ( T.heightAt( x, z + e ) - T.heightAt( x, z - e ) ) / ( 2 * e );
				const nl = ( - gx * - 0.6 + - gz * - 0.6 + 1 * 0.53 ) / Math.sqrt( gx * gx + gz * gz + 1 );
				const s = 0.7 + 0.45 * sat( nl / 0.53 );
				c = [ c[ 0 ] * s, c[ 1 ] * s, c[ 2 ] * s ];

			}

			const o = ( py * N + px ) * 4;
			d[ o ] = c[ 0 ]; d[ o + 1 ] = c[ 1 ]; d[ o + 2 ] = c[ 2 ]; d[ o + 3 ] = 255;

		}

		this.row = end;
		if ( this.row < N ) return false;

		// coastline: a thin pale line where the height crosses sea level
		for ( let py = 1; py < N - 1; py ++ ) for ( let px = 1; px < N - 1; px ++ ) {

			const i = py * N + px, a = H[ i ] >= 0;
			if ( a && ( H[ i - 1 ] < 0 || H[ i + 1 ] < 0 || H[ i - N ] < 0 || H[ i + N ] < 0 ) ) {

				const o = i * 4;
				d[ o ] = d[ o ] * 0.3 + 245 * 0.7; d[ o + 1 ] = d[ o + 1 ] * 0.3 + 241 * 0.7; d[ o + 2 ] = d[ o + 2 ] * 0.3 + 228 * 0.7;

			}

		}

		const ctx = this.ctx;
		ctx.putImageData( this.img, 0, 0 );
		const P = ( x, z ) => [ ( x - X0 ) * PPM, ( z - Z0 ) * PPM ];

		// village pads (house footprints)
		ctx.fillStyle = `rgb(${ C.pad.join( ',' ) })`;
		for ( const p of T.pads || [] ) {

			const [ cx, cy ] = P( p.x, p.z );
			const r = Math.max( 1.5, p.radius * 0.8 * PPM );
			ctx.fillRect( cx - r, cy - r, 2 * r, 2 * r );

		}

		// the pier and its head
		const W = WORLD.pier;
		ctx.fillStyle = '#d9c7a0';
		ctx.strokeStyle = 'rgba(40, 30, 20, 0.55)';
		ctx.lineWidth = 0.6;
		const [ px0, pz0 ] = P( W.x - Math.max( W.width, 3 ) / 2, W.zStart );
		const [ px1, pz1 ] = P( W.x + Math.max( W.width, 3 ) / 2, W.zEnd );
		ctx.fillRect( px0, pz0, px1 - px0, pz1 - pz0 );
		ctx.strokeRect( px0, pz0, px1 - px0, pz1 - pz0 );
		const [ hx0, hz0 ] = P( W.x - W.headWidth / 2, W.zEnd - W.headDepth );
		const [ hx1, hz1 ] = P( W.x + W.headWidth / 2, W.zEnd );
		ctx.fillRect( hx0, hz0, hx1 - hx0, hz1 - hz0 );
		ctx.strokeRect( hx0, hz0, hx1 - hx0, hz1 - hz0 );

		// the other ports' jetties (the world map): a plank-coloured stroke from the sand out over the water
		if ( this.jetties ) for ( const port of WORLD.ports || [] ) {

			const dk = port.dock;
			if ( ! dk || ! dk.start || ! dk.end ) continue;
			const [ ax, ay ] = P( dk.start.x, dk.start.z ), [ bx, by ] = P( dk.end.x, dk.end.z );
			ctx.strokeStyle = '#d9c7a0';
			ctx.lineWidth = Math.max( 1.5, ( dk.width || 2 ) * PPM );
			ctx.lineCap = 'butt';
			ctx.beginPath();
			ctx.moveTo( ax, ay );
			ctx.lineTo( bx, by );
			ctx.stroke();

		}

		this.done = true;
		this.img = null;
		if ( ! this.keepHeights ) this.h = null;
		return true;

	}

}

export class Minimap {

	constructor( parent, game ) {

		this.game = game;
		ensureMapCSS();
		this.waypoint = null;

		this.el = h( 'div', 'gm-map tw-glass', `<div class="gm-map-view"><canvas width="${ N }" height="${ N }"></canvas><div class="gm-map-vig"></div>
			<div class="gm-map-marks"></div>
			<div class="gm-map-me"><svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" stroke="#0b1418" stroke-width="1.4" stroke-linejoin="round"/></svg></div></div>` );
		this.el.setAttribute( 'aria-hidden', 'true' );
		this.view = this.el.querySelector( '.gm-map-view' );
		this.canvas = this.el.querySelector( 'canvas' );
		this.marks = this.el.querySelector( '.gm-map-marks' );
		parent.append( this.el );
		// touch (wave 6): the minimap takes taps while the touch controls are on (ui.css .is-touch .gm-map) and a
		// tap opens the world map; with a mouse it stays click-through
		this.el.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			const f = game.app && game.app.features;
			const wm = f && f.get ? f.get( 'worldmap' ) : null;
			if ( wm && wm.open ) wm.open();

		} );

		const mk = ( kind, icon ) => {

			const e = h( 'div', 'gm-mk is-' + kind, `<b></b><i>${ icon }</i>` );
			this.marks.append( e );
			return { el: e, arrow: e.firstChild };

		};

		this.markers = [
			{ id: 'joe', ...mk( 'joe', ICON.fish ), pos: () => ( { x: STAND.x, z: STAND.z } ) },
			{ id: 'marta', ...mk( 'marta', ICON.anchor ), pos: () => ( { x: CHANDLERY.x, z: CHANDLERY.z } ) },
			{ id: 'pons', ...mk( 'pons', ICON.fish ), pos: () => ( { x: PONS_STAND.x, z: PONS_STAND.z } ) },
			// the other ports (src/game/ports: Gull Rock's lighthouse, Saltmarsh Key's buyer)
			// anchor, plane (Tidemark's airstrip: its own badge, shown once Tidemark is discovered) or fish
			...( ( game.app.ports && game.app.ports.markers ) || [] ).map( ( m ) => ( {
				id: m.id, ...mk( m.icon === 'plane' ? 'airstrip' : 'pons', m.icon === 'anchor' || m.icon === 'plane' ? ICON[ m.icon ] : ICON.fish ), pos: () => ( { x: m.x, z: m.z } ),
				hideWhen: m.port ? () => ! portKnown( game, m.port ) : null,
			} ) ),
			{ id: 'boat', ...mk( 'boat', ICON.boat ), pos: () => {

				const b = game.app.boatCtl;
				return b && game.state.boat ? { x: b.position.x, z: b.position.z } : null;

			}, hideWhen: () => {

				const p = game.app.player;
				return ! game.state.boat || p.mode === 'boat' || p.mode === 'deck';

			} },
			{ id: 'yard', ...mk( 'yard', ICON.anchor ), pos: () => ( { x: YARD.x, z: YARD.z } ), hideWhen: () => !! game.state.boat },
			// the world map's waypoint (hidden while there is none)
			{ id: 'wp', ...mk( 'wp', ICON.flag ), pos: () => this.waypoint },
		];
		this.north = h( 'div', 'gm-map-n', 'N' );
		this.marks.append( this.north );
		this.fish = [ h( 'div', 'gm-map-fish', '<i></i><i></i>' ), h( 'div', 'gm-map-fish', '<i></i><i></i>' ) ];
		this.fish.forEach( ( f ) => this.marks.prepend( f ) );
		this._fishPts = [];
		this._fishT = 0;

		this.radiusM = 110; // world radius shown (m), eased between on foot and at sea
		this._hot = new Set();
		this._size = 0;
		this._bake = new TerrainBake( this.canvas.getContext( '2d' ), { n: N, x0: X0, z0: Z0, ppm: PPM } );
		// wave 13A: a terrain tile outside the heightmap (Tidemark) gets a bake of its own once the player stands on it
		this._tileBake = null;
		this._tileCanvas = null;
		// the view's size, kept by a ResizeObserver (reading clientWidth per frame forces a style +
		// layout pass right after last frame's transform writes)
		this._viewSize = - 1;
		if ( typeof ResizeObserver !== 'undefined' ) {

			this._ro = new ResizeObserver( () => {

				this._viewSize = this.view.clientWidth;

			} );
			this._ro.observe( this.view );

		}

	}

	// style writes only when the value changes
	_setStyle( el, prop, value ) {

		const k = '__gm_' + prop;
		if ( el[ k ] === value ) return;
		el[ k ] = value;
		el.style[ prop ] = value;

	}

	_toggle( el, cls, on ) {

		const k = '__gm_c_' + cls;
		if ( el[ k ] === on ) return;
		el[ k ] = on;
		el.classList.toggle( cls, on );

	}

	highlight( ids = [] ) {

		this._hot = new Set( ids );
		for ( const m of this.markers ) this._toggle( m.el, 'is-hot', this._hot.has( m.id ) );

	}

	// the world map's waypoint: a flag marker (null clears it)
	setWaypoint( p ) {

		this.waypoint = p && Number.isFinite( p.x ) && Number.isFinite( p.z ) ? { x: p.x, z: p.z } : null;

	}

	// a generic pin (same id again: moved / relabelled); the distance from the player is its label
	addMarker( m ) {

		if ( ! m || m.id === undefined || ! Number.isFinite( m.x ) || ! Number.isFinite( m.z ) ) return false;
		const id = 'mk:' + m.id;
		let e = this.markers.find( ( q ) => q.id === id );
		const kind = typeof m.kind === 'string' && /^[\w-]+$/.test( m.kind ) ? m.kind : 'pin';
		if ( ! e ) {

			const el = h( 'div', 'gm-mk is-' + kind, '<b></b><i></i><em></em>' );
			this.marks.insertBefore( el, this.north || null );
			e = { id, el, arrow: el.firstChild, icon: el.children[ 1 ], em: el.children[ 2 ], custom: true, at: { x: m.x, z: m.z }, text: null };
			e.pos = () => e.at;
			this.markers.push( e );

		}

		e.el.className = 'gm-mk is-' + kind;
		e.el.__gm_c_ = undefined;
		for ( const k in e.el ) if ( k.startsWith( '__gm_c_' ) ) e.el[ k ] = undefined;
		e.icon.innerHTML = iconFor( m.icon );
		e.at = { x: m.x, z: m.z };
		e.label = typeof m.label === 'string' ? m.label : '';
		e.el.title = e.label;
		return true;

	}

	removeMarker( id ) {

		const i = this.markers.findIndex( ( q ) => q.id === 'mk:' + id );
		if ( i < 0 ) return false;
		this.markers[ i ].el.remove();
		this.markers.splice( i, 1 );
		return true;

	}

	get baked() {

		return this._bake.done;

	}

	// the terrain tile under the player (wave 13A): its canvas is made once, baked after the home chart
	_tileAt( x, z ) {

		const T = this.game.app.terrainData;
		const tile = terrainTiles( T ).find( ( q ) => x >= q.x0 - 120 && x <= q.x0 + q.size + 120 && z >= q.z0 - 120 && z <= q.z0 + q.size + 120 ) || null;
		if ( ! tile || ( this._tileBake && this._tileBake.id === tile.id ) ) return;
		if ( ! this._tileCanvas ) {

			this._tileCanvas = this.canvas.cloneNode( false );
			this.canvas.after( this._tileCanvas );

		}
		const n = 512;
		this._tileCanvas.width = this._tileCanvas.height = n;
		this._tileBake = new TerrainBake( this._tileCanvas.getContext( '2d' ), { n, x0: tile.x0, z0: tile.z0, ppm: n / tile.size } );
		this._tileBake.id = tile.id;

	}

	// ---- bake (chunked)
	_bakeStep() {

		if ( ! this._bake.done ) this._bake.step( this.game.app.terrainData, ROWS_PER_FRAME );
		else if ( this._tileBake && ! this._tileBake.done ) this._tileBake.step( this.game.app.terrainData, ROWS_PER_FRAME );

	}

	// ---- per frame
	update( dt ) {

		this._bakeStep();
		const app = this.game.app, cam = app.camera, p = app.player;
		if ( this._viewSize < 0 || ! this._ro ) this._viewSize = this.view.clientWidth;
		const size = this._viewSize;
		if ( ! size ) return;
		const R = size / 2;

		// forward (xz) of the view
		const e = cam.matrixWorld.elements;
		let fx = - e[ 8 ], fz = - e[ 10 ];
		const fl = Math.hypot( fx, fz );
		if ( fl < 1e-4 ) {

			fx = 0; fz = - 1;

		} else {

			fx /= fl; fz /= fl;

		}

		const rx = - fz, rz = fx; // right
		const x = cam.position.x, z = cam.position.z;

		// zoom: close on foot, wider at sea
		const want = p.mode === 'boat' || p.mode === 'deck' || p.mode === 'swim' ? 240 : 110;
		this.radiusM += ( want - this.radiusM ) * ( 1 - Math.exp( - dt * 1.5 ) );
		const kpm = R / this.radiusM; // css px per metre

		// map: player at the centre, forward up
		const rot = - Math.PI / 2 - Math.atan2( fz, fx );
		const s = kpm / PPM;
		this._setStyle( this.canvas, 'transform', `translate(${ R }px, ${ R }px) rotate(${ rot }rad) scale(${ s }) translate(${ - ( x - X0 ) * PPM }px, ${ - ( z - Z0 ) * PPM }px)` );
		this._tileAt( x, z );
		if ( this._tileBake ) {

			const b = this._tileBake, s2 = kpm / b.ppm;
			this._setStyle( this._tileCanvas, 'transform', `translate(${ R }px, ${ R }px) rotate(${ rot }rad) scale(${ s2 }) translate(${ - ( x - b.x0 ) * b.ppm }px, ${ - ( z - b.z0 ) * b.ppm }px)` );

		}

		const place = ( el, dx, dz, edgeInset, arrow ) => {

			let sx = ( dx * rx + dz * rz ) * kpm, sy = - ( dx * fx + dz * fz ) * kpm;
			const r = Math.hypot( sx, sy ), max = R - edgeInset;
			const edge = r > max;
			if ( edge ) {

				sx *= max / r; sy *= max / r;

			}

			this._setStyle( el, 'transform', `translate(${ R + sx }px, ${ R + sy }px)` );
			if ( arrow && edge ) this._setStyle( arrow, 'transform', `rotate(${ Math.atan2( sx, - sy ) }rad)` );
			return edge;

		};

		for ( const m of this.markers ) {

			const q = m.pos();
			const hide = ! q || ( m.hideWhen && m.hideWhen() );
			this._setStyle( m.el, 'display', hide ? 'none' : '' );
			if ( hide ) continue;
			const edge = place( m.el, q.x - x, q.z - z, 12, m.arrow );
			this._toggle( m.el, 'is-edge', edge );
			if ( m.custom ) {

				// the distance readout, refreshed in whole metres (a text write only when it changes)
				const me = p && p.position ? p.position : cam.position;
				const t = distText( Math.hypot( q.x - me.x, q.z - me.z ) );
				if ( t !== m.text ) {

					m.text = t;
					m.em.textContent = t;

				}

			}

		}

		// the N on the rim
		place( this.north, 0, - 1e6, 9 );

		// fish finder: the richest water nearby, refreshed now and then
		const finder = this.game.state.stats.finder;
		this._fishT -= dt;
		if ( finder && this._fishT <= 0 ) {

			this._fishT = 1.5;
			this._fishPts = this._richest( x, z, this.radiusM * 0.85 );

		}

		for ( let i = 0; i < this.fish.length; i ++ ) {

			const q = finder ? this._fishPts[ i ] : null;
			this._toggle( this.fish[ i ], 'is-on', !! q );
			if ( q ) place( this.fish[ i ], q.x - x, q.z - z, 14 );

		}

	}

	// the two richest points on a coarse polar grid around (x, z), at least 25 m apart
	_richest( x, z, r ) {

		const g = this.game, T = g.app.terrainData;
		const pts = [];
		for ( let ring = 1; ring <= 3; ring ++ ) for ( let a = 0; a < 12; a ++ ) {

			const ang = ( a / 12 ) * Math.PI * 2 + ring * 0.4, d = r * ring / 3;
			const px = x + Math.cos( ang ) * d, pz = z + Math.sin( ang ) * d;
			const depth = - T.heightAt( px, pz );
			if ( depth < 1 ) continue;
			const hab = g.habitatAtPoint( px, pz, depth );
			let rich = 0;
			for ( const k in hab ) rich += hab[ k ];
			if ( rich > 0.7 ) pts.push( { x: px, z: pz, rich } );

		}

		pts.sort( ( a, b ) => b.rich - a.rich );
		const out = [];
		for ( const q of pts ) if ( out.every( ( o ) => Math.hypot( o.x - q.x, o.z - q.z ) > 25 ) ) {

			out.push( q );
			if ( out.length === 2 ) break;

		}

		return out;

	}

}
