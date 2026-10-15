import { WORLD } from '../world/WorldLayout.js';
import { STAND } from '../game/FishStand.js';
import { CHANDLERY } from '../game/Chandlery.js';
import { PONS_STAND } from '../game/PonsPort.js';
import { YARD } from '../game/BoatYard.js';
import { CAMP } from '../features/melee/MeleeData.js';
import { BOARD_SITES } from '../features/notices/Sites.js';
import { ensureMapCSS, ICON, TerrainBake } from '../game/Minimap.js';
import { pinchStep } from '../core/Touch.js';
import { MapView, edgeClamp, niceScale, pickWaypoint, compass, viewAngle, yawAngle, SEA_MODES, legendRows, discoveryState, portMarkerKind } from '../features/worldmap/MapLogic.js';

// The world map: a full-screen chart drawn like the minimap (the same terrain bake, palette, coastline, round
// white-ringed badges and edge arrows), north up. The whole heightmap is baked once in row chunks (after the
// minimap's own bake, faster while the map is open), at the minimap's 0.5 px per metre.
//
// Layers: terrain bake, the fog of the unexplored sea (a small canvas of soft dots, scaled up), the faint
// silhouettes of islands not yet discovered (only where the fog lies), then the DOM markers and labels.
// Per frame (open only) it writes CSS transforms; the fog and the silhouettes redraw when they change.
//
//   const map = new WorldMap( hudEl, app, feature );   // feature: src/features/worldmap (fog, waypoint, discovered)
//   map.open() / close() / isOpen;  map.update( dt );  map.key( keydownEvent );  map.dispose()
//
// Mouse: drag pans, the wheel zooms (clamped: from the whole world to 2.5 px per metre), a click sets the waypoint
// (a click on it, or the right button, clears it). Keys while open: W A S D / arrows pan, + / - zoom, C back to the
// player, M or Escape close. Gamepad: D-pad left opens / closes, left stick pans, right stick zooms, A sets / clears the
// waypoint at the centre cross, B closes (the pad's game mapping is off while the map is open).
// Wave 13C: the legend lists only what the map can show (MapLogic.legendRows: the airstrip once Tidemark is discovered, the pirate
// island and its battery reach once Blackwater is, wrecks / the sea chest / quest pins / parked planes when there are some);
// islands beyond the heightmap that have their own terrain tile (Tidemark) are baked from it into a canvas of their own; a pirate
// island shows a skull badge once charted and its batteries' reach as red circles (grey once silenced).
// Touch (wave 6): one finger drags, two fingers pinch-zoom about their midpoint (and pan with it), a tap sets the
// waypoint; a pinch never ends in a waypoint (core/Touch.js pinchStep).

const MINOR_K = 0.9; // px per metre: the small markers of a port (chandlery, stalls, boards) show from this zoom
const PAN_KEYS = { KeyW: [ 0, 1 ], ArrowUp: [ 0, 1 ], KeyS: [ 0, - 1 ], ArrowDown: [ 0, - 1 ], KeyA: [ 1, 0 ], ArrowLeft: [ 1, 0 ], KeyD: [ - 1, 0 ], ArrowRight: [ - 1, 0 ] };
const FOG_PX = 4; // fog canvas px per cell
const FOG_COLOR = 'rgba(8, 24, 38, 0.93)';
const REGION_R = 180; // m: a bounty's last known region
const HELICOPTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 10c0-4 1-6 3-6s3 2 3 6v3H9zM12 13v8M8 20h8M3 9h18M8 14v3M16 14v3"/><circle cx="12" cy="9" r="1.4"/></svg>';

// optional localisation (src/i18n/index.js, if another worker added it): t( key, fallback )
let i18n = null;
try {

	const mods = import.meta.glob( '../i18n/index.js', { eager: true } );
	i18n = Object.values( mods )[ 0 ] || null;

} catch ( e ) { /* plain node: no Vite glob */ }

const t = ( key, fallback ) => {

	if ( ! i18n || typeof i18n.t !== 'function' ) return fallback;
	try {

		const s = i18n.t( key, fallback );
		return typeof s === 'string' && s ? s : fallback;

	} catch ( e ) { return fallback; }

};

const esc = ( s ) => String( s == null ? '' : s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
const fmt = ( v ) => ( v < 0 ? '−' : '' ) + Math.abs( Math.round( v ) );
const dist = ( m ) => m >= 1000 ? `${ ( m / 1000 ).toFixed( m >= 10000 ? 0 : 1 ) } km` : `${ Math.round( m ) } m`;

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

const CHART_URL = `${ import.meta.env?.BASE_URL || '/' }ui/codex-nautical-chart.png`;
const CSS = /* css */`
.wm-root { position: absolute; inset: 0; z-index: 45; display: none; pointer-events: auto; background: rgba(3, 9, 15, 0.5);
	-webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); opacity: 0; transition: opacity var(--tw-med) var(--tw-ease); }
.wm-root.is-on { display: block; }
.wm-root.is-shown { opacity: 1; }
.wm-frame { position: absolute; inset: calc(28 * var(--tw-u)); border-radius: calc(26 * var(--tw-u)); padding: calc(5 * var(--tw-u));
	transform: scale(0.985); transition: transform var(--tw-med) var(--tw-ease); }
.wm-root.is-shown .wm-frame { transform: none; }
.wm-view { position: relative; width: 100%; height: 100%; border-radius: calc(21 * var(--tw-u)); overflow: hidden; background: #0b2c48;
	box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 0 28px rgba(0,0,0,0.45); cursor: crosshair; touch-action: none; user-select: none; }
.wm-view.is-drag { cursor: grabbing; }
.wm-art { position:absolute; inset:0; pointer-events:none; background:url('${ CHART_URL }') center / cover; opacity:.18; mix-blend-mode:soft-light; filter:saturate(.4); }
.wm-grid { position:absolute; inset:0; pointer-events:none; background-image:linear-gradient(#d9e5c01a 1px,transparent 1px),linear-gradient(90deg,#d9e5c01a 1px,transparent 1px); }
.wm-bearing { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:hidden; }
.wm-bearing line { stroke:#f2cc7d; stroke-width:2; stroke-dasharray:7 7; opacity:.8; }
.wm-root .gm-mk.is-tracked { z-index:5; }.wm-root .gm-mk.is-tracked > i { background:#f4cf83; box-shadow:0 0 0 3px #142a30,0 0 0 5px #f4cf8399,0 0 26px #f4cf8366; }
.wm-root .gm-mk.is-tracked > em { color:#fff1c6; background:#0a202ee6; padding:5px 8px; border:1px solid #d6b57670; border-radius:5px; max-width:260px; overflow:hidden; text-overflow:ellipsis; }
.wm-controls { position:absolute; right:16px; top:75px; display:flex; flex-direction:column; gap:6px; }
.wm-controls button { cursor:pointer; min-width:44px; min-height:44px; border:1px solid #b6c7ae60; border-radius:7px; color:#f4e8cb; background:#102933ed; font:500 12px var(--tw-font); padding:8px; box-shadow:0 2px 8px #0004; }
.wm-controls button:hover { background:#305353; }.wm-controls button:focus-visible { outline:2px solid #f4cf83; outline-offset:2px; }
.wm-target { position:absolute; top:76px; left:16px; display:flex; flex-direction:column; gap:6px; max-width:min(330px,calc(100% - 130px)); padding:12px 15px; border-left:3px solid #e9c480; border-radius:4px; background:#0a202eea; box-shadow:0 8px 24px #0005; color:#e2e9dd; pointer-events:none; }
.wm-target[hidden] { display:none; }.wm-target small { color:#d4b77c; letter-spacing:.12em; font-size:9px; }.wm-target b { font-size:14px; font-weight:500; }.wm-target span { font:11px var(--tw-mono); color:#afc8c9; }
.wm-view { border:1px solid #bac7ab50; }.wm-head { text-shadow:0 1px 3px #000; }.wm-compass { color:#f0d4a1; }
@media(max-width:600px) { .wm-target { top:68px; max-width:calc(100% - 115px); padding:8px; }.wm-target b { font-size:12px; }.wm-controls { right:10px; top:68px; }.wm-root .gm-mk.is-tracked > em { max-width:165px; } }
@media(max-height:520px) { .wm-controls { top:62px; right:10px; display:grid; grid-template-columns:repeat(2,minmax(44px,auto)); gap:5px; }.wm-target { top:62px; max-width:calc(100% - 200px); } }
.wm-view canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; image-rendering: auto; }
.wm-vig { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 50%, transparent 62%, rgba(4, 12, 20, 0.5) 100%); }
.wm-marks { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.wm-root .gm-mk > em { position: absolute; left: 0; top: calc(13 * var(--tw-u)); transform: translateX(-50%); font: 500 var(--tw-fs-xs) var(--tw-mono);
	font-style: normal; color: var(--tw-ink-2); white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.85), 0 0 6px rgba(0,0,0,0.5); }
.wm-root .gm-mk.is-edge > em { display: none; }
.wm-root .gm-mk.is-yard > i, .wm-lg .is-yard { background: #f2efe6; }
.wm-root .gm-mk.is-plane > i, .wm-lg .is-plane { background: #dfe9ee; }
.wm-root .gm-mk.is-helicopter > i, .wm-lg .is-helicopter { background: #f2c487; }
.wm-root .gm-mk.is-me.is-helicopter > i { background:#f2c487; color:#132831; border-radius:50%; box-shadow:0 0 0 2px #eaf2d9; }
.wm-root .gm-mk.is-trade > i, .wm-lg .is-trade { background: #a8d68a; }
.wm-root .gm-mk.is-board > i, .wm-lg .is-board { background: #e8dcc0; }
.wm-root .gm-mk.is-camp > i, .wm-lg .is-camp { background: #d98a6a; }
.wm-root .gm-mk.is-pirate > i, .wm-lg .is-pirate { background: var(--tw-coral); }
.wm-root .gm-mk.is-bounty > i, .wm-lg .is-bounty { background: var(--tw-coral); color: #fff; }
.wm-root .gm-mk.is-bounty > em { color: #ffc2c7; }
.wm-root .gm-mk.is-me > i { background: none; box-shadow: none; width: calc(22 * var(--tw-u)); height: calc(22 * var(--tw-u)); margin: calc(-11 * var(--tw-u)) 0 0 calc(-11 * var(--tw-u)); }
.wm-root .gm-mk.is-me > i svg { width: 100%; height: 100%; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.wm-root .gm-mk.is-me::before { content: ''; position: absolute; left: calc(-16 * var(--tw-u)); top: calc(-16 * var(--tw-u)); width: calc(32 * var(--tw-u)); height: calc(32 * var(--tw-u));
	border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.8); animation: gm-map-ring 2.2s var(--tw-ease-io) infinite; }
.wm-root .gm-mk.is-me.is-edge::before { display: none; }
.wm-root .gm-mk.is-peer > i { width: calc(11 * var(--tw-u)); height: calc(11 * var(--tw-u)); margin: calc(-5.5 * var(--tw-u)) 0 0 calc(-5.5 * var(--tw-u));
	background: var(--tw-aqua); box-shadow: 0 0 0 1.5px rgba(255,255,255,0.85), 0 0 8px rgba(var(--tw-aqua-rgb), 0.8); }
.wm-root .gm-mk.is-peer > em { top: calc(8 * var(--tw-u)); color: var(--tw-ink); }
.wm-root .gm-mk.is-peer.is-boat > i { background: var(--tw-sun); box-shadow: 0 0 0 1.5px rgba(255,255,255,0.85), 0 0 8px rgba(var(--tw-sun-rgb), 0.8); }
.wm-place { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.wm-place > span { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); white-space: nowrap; font: 600 calc(11 * var(--tw-u)) var(--tw-font);
	letter-spacing: 0.16em; text-transform: uppercase; color: rgba(248, 244, 232, 0.9); text-shadow: 0 1px 3px rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.45); }
.wm-place.is-unknown > span { display: grid; place-items: center; width: calc(28 * var(--tw-u)); height: calc(28 * var(--tw-u)); border-radius: 50%; letter-spacing: 0;
	border: 1.5px dashed rgba(220, 236, 242, 0.55); font: 700 calc(15 * var(--tw-u)) var(--tw-font); color: rgba(220, 236, 242, 0.8); background: rgba(8, 24, 38, 0.35); }
.wm-region { position: absolute; left: 0; top: 0; border-radius: 50%; border: 1.5px dashed rgba(255, 122, 133, 0.75); background: rgba(255, 122, 133, 0.08);
	box-sizing: border-box; transform-origin: 50% 50%; }
.wm-region > em { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 4px); font: 500 var(--tw-fs-xs) var(--tw-mono); font-style: normal;
	color: #ffc2c7; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.85); }
.wm-region.is-zone { border-color: rgba(255, 196, 92, 0.8); background: rgba(255, 196, 92, 0.07); }
.wm-region.is-zone > em { color: #ffd99a; }
.wm-lg > i.is-zone { background: rgba(255, 196, 92, 0.12); box-shadow: none; border: 1.2px dashed rgba(255, 196, 92, 0.9); }
.wm-region.is-battery { border-color: rgba(255, 96, 84, 0.9); background: rgba(255, 96, 84, 0.1); }
.wm-region.is-battery > em { color: #ffb4ab; }
.wm-region.is-silenced { border-color: rgba(190, 200, 205, 0.7); background: rgba(190, 200, 205, 0.06); }
.wm-region.is-silenced > em { color: #cfd8dc; }
.wm-lg > i.is-battery { background: rgba(255, 96, 84, 0.14); box-shadow: none; border: 1.2px dashed rgba(255, 96, 84, 0.95); }
.wm-cross { position: absolute; left: 50%; top: 50%; width: calc(26 * var(--tw-u)); height: calc(26 * var(--tw-u)); transform: translate(-50%, -50%); display: none;
	pointer-events: none; background: linear-gradient(rgba(255,255,255,0.85), rgba(255,255,255,0.85)) center / 1.5px 100% no-repeat,
	linear-gradient(rgba(255,255,255,0.85), rgba(255,255,255,0.85)) center / 100% 1.5px no-repeat; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.7)); }
.wm-view.is-pad .wm-cross { display: block; }
.wm-head { position: absolute; left: calc(18 * var(--tw-u)); top: calc(14 * var(--tw-u)); pointer-events: none; }
.wm-head b { display: block; font: 600 var(--tw-fs-lg) var(--tw-font); letter-spacing: 0.16em; text-transform: uppercase; color: var(--tw-ink); text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
.wm-head span { display: block; min-height: 1.3em; margin-top: calc(2 * var(--tw-u)); font: 500 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-3); text-shadow: 0 1px 2px rgba(0,0,0,0.7); }
.wm-close { position: absolute; right: calc(14 * var(--tw-u)); top: calc(14 * var(--tw-u)); width: calc(30 * var(--tw-u)); height: calc(30 * var(--tw-u)); border-radius: 50%;
	display: grid; place-items: center; cursor: pointer; border: 1px solid var(--tw-line-2); background: rgba(12, 18, 26, 0.55); color: var(--tw-ink);
	font: 400 calc(18 * var(--tw-u)) / 1 var(--tw-font); padding: 0; }
.wm-close:hover { background: rgba(40, 60, 76, 0.7); }
.tw-root.is-coarse .wm-close { width: 44px; height: 44px; }
.tw-root.is-coarse .wm-legend-btn { height: 40px; }
.tw-root.is-coarse .wm-frame { inset: calc(8px + env(safe-area-inset-top, 0px)) calc(8px + env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) calc(8px + env(safe-area-inset-left, 0px)); }
.wm-compass { position: absolute; right: calc(54 * var(--tw-u)); top: calc(8 * var(--tw-u)); width: calc(42 * var(--tw-u)); height: calc(42 * var(--tw-u)); pointer-events: none;
	filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6)); }
.wm-compass svg { width: 100%; height: 100%; }
.wm-legend-btn { position: absolute; left: calc(14 * var(--tw-u)); bottom: calc(14 * var(--tw-u)); height: calc(26 * var(--tw-u)); padding: 0 calc(10 * var(--tw-u));
	border-radius: var(--tw-r-md); border: 1px solid var(--tw-line-2); background: rgba(12, 18, 26, 0.55); color: var(--tw-ink-2); cursor: pointer;
	font: 500 var(--tw-fs-xs) var(--tw-font); letter-spacing: 0.06em; }
.wm-legend-btn:hover { background: rgba(40, 60, 76, 0.7); color: var(--tw-ink); }
.wm-legend-btn::after { content: ' ▴'; }
.wm-root.is-legend .wm-legend-btn::after { content: ' ▾'; }
.wm-legend { display: none; }
.wm-root.is-legend .wm-legend { display: grid; }
.wm-legend { position: absolute; left: calc(14 * var(--tw-u)); bottom: calc(46 * var(--tw-u)); padding: calc(8 * var(--tw-u)) calc(10 * var(--tw-u));
	border-radius: var(--tw-r-md); display: grid; grid-template-columns: repeat(2, auto); gap: calc(4 * var(--tw-u)) calc(14 * var(--tw-u)); pointer-events: none;
	font: 500 var(--tw-fs-xs) var(--tw-font); color: var(--tw-ink-2); }
.wm-lg { display: flex; align-items: center; gap: calc(6 * var(--tw-u)); white-space: nowrap; }
.wm-lg > i { display: grid; place-items: center; flex: none; width: calc(14 * var(--tw-u)); height: calc(14 * var(--tw-u)); border-radius: 50%; color: #0b1418;
	box-shadow: 0 0 0 1px rgba(255,255,255,0.8); }
.wm-lg > i svg { width: 70%; height: 70%; }
.wm-lg > i.is-joe, .wm-lg > i.is-pons { background: var(--tw-sun); }
.wm-lg > i.is-marta { background: var(--tw-aqua); }
.wm-lg > i.is-boat { background: #f2efe6; }
.wm-lg > i.is-wp { background: #fff3a8; color: #d8434f; }
.wm-lg > i.is-me { background: none; box-shadow: none; }
.wm-lg > i.is-me svg { width: 100%; height: 100%; }
.wm-lg > i.is-peer { width: calc(9 * var(--tw-u)); height: calc(9 * var(--tw-u)); margin: 0 calc(2.5 * var(--tw-u)); background: var(--tw-aqua); }
.wm-lg > i.is-fog { border-radius: 3px; background: ${ FOG_COLOR }; box-shadow: 0 0 0 1px rgba(255,255,255,0.35); }
.wm-lg > i.is-unknown { background: none; box-shadow: none; border: 1.2px dashed rgba(220, 236, 242, 0.7); color: rgba(220, 236, 242, 0.9); font: 700 calc(9 * var(--tw-u)) var(--tw-font); }
.wm-scale { position: absolute; right: calc(18 * var(--tw-u)); bottom: calc(16 * var(--tw-u)); pointer-events: none; text-align: right;
	font: 500 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-2); text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
.wm-scale > i { display: block; height: calc(6 * var(--tw-u)); margin: calc(3 * var(--tw-u)) 0 0 auto; border: 1.5px solid rgba(255,255,255,0.85); border-top: 0;
	box-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.wm-coords { position: absolute; left: 50%; bottom: calc(14 * var(--tw-u)); transform: translateX(-50%); pointer-events: none; text-align: center; white-space: nowrap;
	font: 500 var(--tw-fs-sm) var(--tw-mono); color: var(--tw-ink); text-shadow: 0 1px 2px rgba(0,0,0,0.85); }
.wm-coords small { display: block; margin-top: calc(3 * var(--tw-u)); font: 400 var(--tw-fs-xs) var(--tw-font); color: var(--tw-ink-3); }
@media (max-width: 760px), (max-height: 560px) { .wm-root.is-legend .wm-legend, .wm-legend-btn { display: none; } .wm-frame { inset: calc(10 * var(--tw-u)); } .wm-coords small { display: none; } }
@media (prefers-reduced-motion: reduce) { .wm-root .gm-mk.is-me::before { animation: none; } .wm-frame, .wm-root { transition: none; } }
`;

let cssInjected = false;

const COMPASS = /* svg */`<svg viewBox="-50 -50 100 100" aria-hidden="true">
	<circle r="46" fill="rgba(11, 20, 28, 0.42)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
	<circle r="37" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.8" stroke-dasharray="1.2 3.2"/>
	<g transform="rotate(45) scale(0.6)" opacity="0.75"><path d="M0 -40 6 -6 40 0 6 6 0 40 -6 6 -40 0 -6 -6Z" fill="rgba(255,255,255,0.75)"/></g>
	<path d="M0 -40 6 -6 40 0 6 6 0 40 -6 6 -40 0 -6 -6Z" fill="rgba(245, 241, 228, 0.92)"/>
	<path d="M0 -40 6 -6 0 0ZM40 0 6 6 0 0ZM0 40 -6 6 0 0ZM-40 0 -6 -6 0 0Z" fill="rgba(11, 20, 28, 0.35)"/>
	<path d="M0 -40 6 -6 0 0 -6 -6Z" fill="#ff7a85"/>
	<circle r="3" fill="#0b1418"/>
	<text x="0" y="-41" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="13" fill="#fff" stroke="rgba(0,0,0,0.55)" stroke-width="0.6" paint-order="stroke" dy="-1">N</text>
</svg>`;

export class WorldMap {

	constructor( parent, app, feature ) {

		this.app = app;
		this.feature = feature;
		this.isOpen = false;
		ensureMapCSS();
		if ( ! cssInjected ) {

			cssInjected = true;
			const style = h( 'style' );
			style.textContent = CSS;
			document.head.append( style );

		}

		this.el = h( 'div', 'wm-root tw-interactive', `<div class="wm-frame tw-glass"><div class="wm-view">
				<canvas class="wm-terrain"></canvas><canvas class="wm-fog"></canvas><canvas class="wm-sil"></canvas>
				<div class="wm-art" aria-hidden="true"></div><div class="wm-grid" aria-hidden="true"></div>
				<svg class="wm-bearing" aria-hidden="true"><line /></svg>
				<div class="wm-vig"></div><div class="wm-marks"></div><div class="wm-cross"></div>
				<div class="wm-target" hidden><small>TRACKED QUEST · DIRECT BEARING</small><b></b><span></span></div>
				<div class="wm-controls" role="group" aria-label="Chart controls"><button type="button" data-map-control="in" aria-label="Zoom in">＋</button><button type="button" data-map-control="out" aria-label="Zoom out">−</button><button type="button" data-map-control="fit">Fit chart</button><button type="button" data-map-control="you">You</button><button type="button" data-map-control="quest">Quest</button><button type="button" data-map-control="clear">Untrack</button><button type="button" data-map-control="journal">Journal</button></div>
				<div class="wm-head"><b></b><span></span></div>
				<button type="button" class="wm-close" aria-label="Close">×</button>
				<div class="wm-compass">${ COMPASS }</div>
				<div class="wm-legend tw-glass"></div>
				<button type="button" class="wm-legend-btn" aria-expanded="false"></button>
				<div class="wm-scale"><span></span><i></i></div>
				<div class="wm-coords"><span></span><small></small></div>
			</div></div>` );
		this.el.setAttribute( 'role', 'dialog' );
		this.el.setAttribute( 'aria-modal', 'true' );
		const q = ( s ) => this.el.querySelector( s );
		this.viewEl = q( '.wm-view' );
		this.gridEl = q( '.wm-grid' );
		this.bearingEl = q( '.wm-bearing line' );
		this.targetEl = q( '.wm-target' );
		for ( const b of this.el.querySelectorAll( '[data-map-control]' ) ) b.onclick = () => {

			const action = b.dataset.mapControl;
			if ( action === 'in' || action === 'out' ) { this.view.zoomAt( action === 'in' ? 1.4 : 1 / 1.4 ); this._zoomed = true; }
			else if ( action === 'fit' ) this.view.fit();
			else if ( action === 'you' ) { const p = this._playerPos(); if ( p ) this.view.centerOn( p.x, p.z ); }
			else if ( action === 'quest' ) { const m = this.feature.markers.get( 'journal-target' ); if ( m ) this.focusOn( m ); }
			else if ( action === 'clear' ) this.feature.clearTrackedQuest();
			else if ( action === 'journal' ) { this.close(); this.app.features?.get?.( 'notices' )?.toggleJournal(); }

		};
		this.terrainCanvas = q( '.wm-terrain' );
		this.fogCanvas = q( '.wm-fog' );
		this.silCanvas = q( '.wm-sil' );
		this.marksEl = q( '.wm-marks' );
		this.headEl = q( '.wm-head' );
		this.legendEl = q( '.wm-legend' );
		this.legendBtn = q( '.wm-legend-btn' );
		this.scaleEl = q( '.wm-scale' );
		this.coordsEl = q( '.wm-coords' );
		this.closeEl = q( '.wm-close' );
		this.compassEl = q( '.wm-compass' );
		this._legendUser = null; // the player's own legend choice (null: it opens when it covers no island)
		this.scaleText = q( '.wm-scale > span' );
		this.scaleBar = q( '.wm-scale > i' );
		this.coordsText = q( '.wm-coords > span' );
		this.coordsHint = q( '.wm-coords > small' );
		parent.append( this.el );

		this.view = new MapView( feature.bounds );
		this._zoomed = false; // the first open picks a zoom; later opens keep the player's
		this._marks = new Map(); // key -> { el, i, b, em, kind, icon, label, seen }
		this._places = new Map();
		this._regions = new Map();
		this._frame = 0;
		this._pt = { x: 0, y: 0 };
		this._hover = null; // { x, y } in view px, or null
		this._drag = null;
		this._held = new Set();
		this._fogSig = '';
		this._silSig = '';
		this._dot = null;
		this._mask = null;
		this._age = 0;
		this._openedAt = 0;
		this._pad = { prev: [], mode: false, gameOff: false, closeArm: false };
		this._relock = false;

		// the whole heightmap at the minimap's resolution (0.5 px per metre), capped for huge worlds
		this._bake = null;
		this._outer = []; // islands beyond the heightmap with their own terrain tile: { id, canvas, bake }
		this._initBake();

		// the view's size, kept by a ResizeObserver (no layout reads per frame)
		this._w = 0;
		this._h = 0;
		if ( typeof ResizeObserver !== 'undefined' ) {

			this._ro = new ResizeObserver( () => {

				this._w = this.viewEl.clientWidth;
				this._h = this.viewEl.clientHeight;

			} );
			this._ro.observe( this.viewEl );

		}

		this._bind();

	}

	_initBake() {

		const T = this.app.terrainData;
		if ( ! T || ! Number.isFinite( T.size ) ) return;
		const n = Math.max( 256, Math.min( globalThis.__phoneBudget ? ( globalThis.__phoneBudget.worldMapBake || 1024 ) : 1536, Math.round( T.size * 0.5 ) ) );
		this.terrainCanvas.width = this.silCanvas.width = n;
		this.terrainCanvas.height = this.silCanvas.height = n;
		this.terrainCanvas.style.width = this.silCanvas.style.width = n + 'px';
		this.terrainCanvas.style.height = this.silCanvas.style.height = n + 'px';
		this._bake = new TerrainBake( this.terrainCanvas.getContext( '2d' ), { n, x0: T.origin, z0: T.origin, ppm: n / T.size, jetties: true, keepHeights: true } );

	}

	// Tidemark and any other tile island lie outside the heightmap the main bake covers: each gets a canvas of its own, baked from
	// the terrain's answers there (TerrainData.heightAt reads the attached tile), at about 0.5 px per metre
	_initOuter() {

		const T = this.app.terrainData;
		if ( ! T || ! Number.isFinite( T.size ) ) return;
		for ( const isl of WORLD.islands || [] ) {

			if ( ! isl || ! isl.tile || ! isl.center || this._outer.some( ( o ) => o.id === isl.id ) ) continue;
			const R = ( isl.radius || 300 ) + 80, n = Math.max( 128, Math.min( globalThis.__phoneBudget ? ( globalThis.__phoneBudget.worldMapBake || 1024 ) : 1024, Math.round( R ) ) );
			const canvas = h( 'canvas', 'wm-outer' );
			canvas.width = canvas.height = n;
			canvas.style.width = canvas.style.height = n + 'px';
			this.terrainCanvas.after( canvas );
			const bake = new TerrainBake( canvas.getContext( '2d' ), { n, x0: isl.center.x - R, z0: isl.center.z - R, ppm: n / ( 2 * R ), jetties: true } );
			this._outer.push( { id: isl.id, canvas, bake } );

		}

	}

	// ---- input

	_bind() {

		const v = this.viewEl;
		this._fingers = new Map(); // pointerId -> { x, y } (touch / pen)
		this._pinched = false; // two fingers were down: no waypoint until every finger is up
		this._onDown = ( e ) => {

			if ( e.target.closest && e.target.closest( '.wm-close, .wm-legend-btn, .wm-controls' ) ) return;
			if ( e.button !== 0 && e.button !== 2 ) return;
			e.preventDefault();
			this._pad.mode = false;
			try { v.setPointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
			if ( e.pointerType === 'touch' || e.pointerType === 'pen' ) {

				this._fingers.set( e.pointerId, { x: e.clientX, y: e.clientY } );
				if ( this._fingers.size >= 2 ) {

					// a second finger: the drag becomes a pinch
					this._pinched = true;
					this._drag = null;
					v.classList.remove( 'is-drag' );
					return;

				}

				if ( this._pinched ) return;

			}

			this._drag = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, moved: false };

		};

		this._onMove = ( e ) => {

			const r = v.getBoundingClientRect();
			this._hover = { x: e.clientX - r.left, y: e.clientY - r.top };
			const f = this._fingers.get( e.pointerId );
			if ( f && this._fingers.size >= 2 ) {

				// the pinch: this finger and the first other one
				let o = null;
				for ( const [ id, p ] of this._fingers ) if ( id !== e.pointerId ) { o = p; break; }
				const a1 = { x: e.clientX, y: e.clientY };
				const st = pinchStep( f, o, a1, o );
				f.x = a1.x;
				f.y = a1.y;
				if ( st.dx || st.dy ) this.view.panBy( st.dx, st.dy );
				if ( st.scale !== 1 ) {

					this.view.zoomAt( st.scale, st.cx - r.left, st.cy - r.top );
					this._zoomed = true;

				}

				return;

			}

			if ( f ) {

				f.x = e.clientX;
				f.y = e.clientY;

			}

			const d = this._drag;
			if ( ! d || d.id !== e.pointerId ) return;
			const dx = e.clientX - d.x, dy = e.clientY - d.y;
			if ( ! d.moved && Math.hypot( dx, dy ) < 4 ) return;
			if ( ! d.moved ) v.classList.add( 'is-drag' );
			d.moved = true;
			d.x = e.clientX;
			d.y = e.clientY;
			this.view.panBy( dx, dy );

		};

		this._onUp = ( e ) => {

			if ( this._fingers.delete( e.pointerId ) && this._fingers.size === 0 ) this._pinched = false;
			const d = this._drag;
			if ( ! d || d.id !== e.pointerId ) return;
			this._drag = null;
			v.classList.remove( 'is-drag' );
			try { v.releasePointerCapture( e.pointerId ); } catch ( err ) { /* ignore */ }
			if ( d.moved ) return;
			const r = v.getBoundingClientRect();
			if ( d.button === 2 ) this.feature.setWaypoint( null );
			else this._clickAt( e.clientX - r.left, e.clientY - r.top );

		};

		this._onLeave = () => {

			if ( ! this._drag ) this._hover = null;

		};

		this._onWheel = ( e ) => {

			e.preventDefault();
			const r = v.getBoundingClientRect();
			const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
			this.view.zoomAt( Math.exp( - Math.max( - 240, Math.min( 240, dy ) ) * 0.0016 ), e.clientX - r.left, e.clientY - r.top );
			this._zoomed = true;

		};

		this._onMenu = ( e ) => e.preventDefault();
		this._onClose = ( e ) => {

			e.preventDefault();
			this.close( true );

		};

		v.addEventListener( 'pointerdown', this._onDown );
		v.addEventListener( 'pointermove', this._onMove );
		v.addEventListener( 'pointerup', this._onUp );
		v.addEventListener( 'pointercancel', this._onUp );
		v.addEventListener( 'pointerleave', this._onLeave );
		v.addEventListener( 'wheel', this._onWheel, { passive: false } );
		this.el.addEventListener( 'contextmenu', this._onMenu );
		this.el.querySelector( '.wm-close' ).addEventListener( 'click', this._onClose );
		this._onLegend = ( e ) => {

			e.preventDefault();
			this._legendUser = ! this.el.classList.contains( 'is-legend' );
			this._setLegend( this._legendUser );

		};

		this.legendBtn.addEventListener( 'click', this._onLegend );
		this._onKeyUp = ( e ) => this._held.delete( e.code );
		window.addEventListener( 'keyup', this._onKeyUp );
		window.addEventListener( 'blur', this._onBlur = () => this._held.clear() );

	}

	_clickAt( sx, sy ) {

		const w = this.view.toWorld( sx, sy );
		this.feature.setWaypoint( pickWaypoint( this.feature.waypoint, w.x, w.z, this.view.k ) );

	}

	// window keydown (capture), from the feature: M toggles; while open the map keeps the keys it uses
	key( e ) {

		const plain = ! e.shiftKey && ! e.ctrlKey && ! e.altKey && ! e.metaKey;
		const take = () => {

			e.preventDefault();
			e.stopImmediatePropagation();

		};

		if ( e.code === 'KeyM' && plain && this.feature.keyOk !== false ) {

			if ( ! this.isOpen && ! this._canOpen() ) return;
			take();
			if ( ! e.repeat ) {

				if ( this.isOpen ) this.close( true );
				else this.open();

			}

			return;

		}

		if ( ! this.isOpen ) return;
		if ( e.code === 'Escape' ) {

			take();
			if ( ! e.repeat ) this.close( false );
			return;

		}

		if ( e.ctrlKey || e.altKey || e.metaKey ) return;
		if ( PAN_KEYS[ e.code ] ) {

			take();
			this._held.add( e.code );
			this._pad.mode = false;

		} else if ( e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'Minus' || e.code === 'NumpadSubtract' ) {

			take();
			this.view.zoomAt( e.code === 'Equal' || e.code === 'NumpadAdd' ? 1.25 : 0.8 );
			this._zoomed = true;

		} else if ( e.code === 'KeyC' ) {

			take();
			const p = this._playerPos();
			if ( p ) this.view.centerOn( p.x, p.z );

		}

	}

	_canOpen() {

		const app = this.app, ui = app.ui && app.ui.ui;
		if ( app.menuOpen || ( app.menu && app.menu.open ) || ( app.pauseMenu && app.pauseMenu.isOpen ) ) return false;
		if ( app.input && app.input.enabled === false ) return false;
		if ( ui && ( ui._start || ui._photo || ui.helpOpen ) ) return false;
		if ( app.chat && app.chat.isOpen ) return false;
		return true;

	}

	open() {

		if ( this.isOpen ) return true;
		if ( ! this._canOpen() ) return false;
		this.isOpen = true;
		this._openedAt = this._age;
		this._held.clear();
		this._hover = null;
		this._labels();
		this.el.classList.add( 'is-on' );
		void this.el.offsetWidth;
		this.el.classList.add( 'is-shown' );
		this._w = this.viewEl.clientWidth;
		this._h = this.viewEl.clientHeight;
		this.view.setSize( this._w, this._h );
		this._measureInsets();
		// the first open shows the whole world inside the free area; later opens keep the zoom, centred on the player
		if ( ! this._zoomed ) this.view.fit();
		else {

			const p = this._playerPos();
			if ( p ) this.view.centerOn( p.x, p.z );
			else this.view.clamp();

		}

		this._setLegend( this._legendUser !== null ? this._legendUser : ! this._legendCovers() );

		// free the mouse; the pause menu reads a lost pointer lock as Escape unless it knows the map took it
		// (stopgap until PauseMenu._busy() checks features.panelOpen(); see the world map report)
		this._relock = typeof document !== 'undefined' && !! document.pointerLockElement;
		if ( this._relock ) {

			const pm = this.app.pauseMenu;
			if ( pm && '_wasLocked' in pm ) pm._wasLocked = false;
			try { document.exitPointerLock(); } catch ( e ) { /* ignore */ }

		}

		// the pad pans the map now, not the player
		const gp = this.app.gamepad;
		if ( gp && gp.enabled !== false ) {

			if ( typeof gp._releaseAll === 'function' ) gp._releaseAll();
			gp.enabled = false;
			this._pad.gameOff = true;

		}

		this._render( 0 );
		return true;

	}

	// gesture: closed by a key or a click (the pointer lock can come back), not by Escape
	focusOn( p ) {

		if ( ! p || ! Number.isFinite( p.x ) || ! Number.isFinite( p.z ) ) return false;
		this.view.k = Math.min( this.view.kMax, Math.max( this.view.kMin * 2.5, 0.35 ) );
		this.view.centerOn( p.x, p.z );
		this._zoomed = true;
		this._render( 0 );
		return true;

	}

	close( gesture = false ) {

		if ( ! this.isOpen ) return;
		this.isOpen = false;
		this._drag = null;
		this._held.clear();
		this.viewEl.classList.remove( 'is-drag', 'is-pad' );
		this.el.classList.remove( 'is-shown', 'is-on' );
		if ( this._pad.gameOff && this.app.gamepad ) this.app.gamepad.enabled = true;
		this._pad.gameOff = false;
		if ( gesture && this._relock && this.app.input && this.app.input.requestLock ) this.app.input.requestLock();
		this._relock = false;

	}

	// the bars the map keeps clear: the title, compass and close button on top; the legend button, the status line
	// and the scale bar below (read on open and on resize only)
	_measureInsets() {

		const bottomOf = ( e ) => e && e.offsetParent ? e.offsetTop + e.offsetHeight : 0;
		const topOf = ( e ) => e && e.offsetParent ? e.offsetTop : this._h;
		const top = Math.max( bottomOf( this.headEl ), bottomOf( this.closeEl ), bottomOf( this.compassEl ) );
		const low = Math.min( topOf( this.coordsEl ), topOf( this.scaleEl ), topOf( this.legendBtn ) );
		const gap = 10;
		this.view.setInsets( { top: top + gap, bottom: Math.max( 0, this._h - low ) + gap, left: gap, right: gap } );

	}

	_setLegend( on ) {

		this._toggle( this.el, 'is-legend', !! on );
		this.legendBtn.setAttribute( 'aria-expanded', on ? 'true' : 'false' );

	}

	// would the open legend cover an island (its shape or its name) in the current view?
	_legendCovers() {

		const L = this.legendEl;
		const was = this.el.classList.contains( 'is-legend' );
		if ( ! was ) this.el.classList.add( 'is-legend' );
		const r = L.offsetParent ? { x0: L.offsetLeft, y0: L.offsetTop, x1: L.offsetLeft + L.offsetWidth, y1: L.offsetTop + L.offsetHeight } : null;
		if ( ! was ) this.el.classList.remove( 'is-legend' );
		if ( ! r || r.x1 <= r.x0 ) return false;
		const V = this.view, pad = 14;
		for ( const isl of WORLD.islands || [] ) {

			if ( ! isl || ! isl.center ) continue;
			const s = V.toScreen( isl.center.x, isl.center.z, {} ), rad = ( isl.radius || 0 ) * V.k + pad;
			const nx = Math.max( r.x0, Math.min( s.x, r.x1 ) ), ny = Math.max( r.y0, Math.min( s.y, r.y1 ) );
			if ( ( nx - s.x ) ** 2 + ( ny - s.y ) ** 2 <= rad * rad ) return true;

		}

		return false;

	}

	// the title, the legend and the hint (localised when src/i18n is there)
	_labels() {

		this.headEl.querySelector( 'b' ).textContent = t( 'worldmap.title', 'World map' );
		const touch = typeof document !== 'undefined' && !! document.querySelector( '.tw-root.is-touch' );
		this.coordsHint.textContent = touch ? t( 'worldmap.hint_touch', 'Drag to pan · pinch to zoom · tap: waypoint' )
			: t( 'worldmap.hint', 'Drag to pan · wheel to zoom · click: waypoint · M / Esc to close' );
		// the rows follow what the map can show now: the kinds of marker on it, and what is discovered
		const now = [];
		try { this._collect( now ); } catch ( e ) { /* the legend still lists the fixed rows */ }
		const kinds = new Set( now.map( ( m ) => String( m.kind ).split( ' ' )[ 0 ] ) );
		const rows = legendRows( { discovered: ( id ) => this.feature.discovered( id ), sandbox: this.feature.sandbox, kinds } )
			.map( ( r ) => [ r.kind, r.icon === '?' ? '?' : r.icon ? ICON[ r.icon ] || '' : '', t( r.key, r.text ) ] );
		if ( now.some( ( m ) => m.key === 'helicopter' || m.kind.includes( 'is-helicopter' ) ) ) rows.splice( 3, 0, [ 'helicopter', HELICOPTER_ICON, t( 'worldmap.helicopter', 'Rescue helicopter' ) ] );
		this.legendBtn.textContent = t( 'worldmap.legend', 'Legend' );
		this.legendEl.innerHTML = rows.map( ( [ k, icon, text ] ) => `<span class="wm-lg"><i class="is-${ k }">${ icon }</i>${ esc( text ) }</span>` ).join( '' );

	}

	// ---- per frame

	update( dt ) {

		this._age += dt;
		this._bakeStep();
		this._gamepad( dt );
		if ( ! this.isOpen ) return;
		// the menu, photo mode or a recaptured pointer (the game took the mouse back) close the map
		const ui = this.app.ui && this.app.ui.ui;
		// (exitPointerLock is asynchronous: the lock may linger a frame or two after opening)
		const relocked = typeof document !== 'undefined' && document.pointerLockElement && this._age - this._openedAt > 0.5;
		if ( this.app.menuOpen || ( ui && ui._photo ) || relocked ) {

			this.close( false );
			return;

		}

		this._render( dt );

	}

	// after the minimap's bake (or a few seconds), in small chunks; much faster while the map is open
	_bakeStep() {

		const B = this._bake;
		if ( ! B ) {

			if ( this.app.terrainData ) this._initBake();
			return;

		}

		if ( B.done ) {

			// then the tile islands, one at a time
			if ( ! this._outer.length ) this._initOuter();
			for ( const o of this._outer ) if ( ! o.bake.done ) {

				o.bake.step( this.app.terrainData, this.isOpen ? 160 : 24 );
				break;

			}

			return;

		}

		const mm = this.app.game && this.app.game.minimap;
		if ( ! this.isOpen && ! ( mm && mm.baked ) && this._age < 4 ) return;
		B.step( this.app.terrainData, this.isOpen ? 160 : 24 );

	}

	_gamepad( dt ) {

		if ( typeof navigator === 'undefined' || ! navigator.getGamepads ) return;
		let pad = null;
		try {

			for ( const p of navigator.getGamepads() ) if ( p && p.connected ) { pad = p; break; }

		} catch ( e ) { return; }

		const P = this._pad;
		if ( ! pad ) {

			P.prev.length = 0;
			return;

		}

		const btn = ( i ) => !! ( pad.buttons[ i ] && ( pad.buttons[ i ].pressed || pad.buttons[ i ].value > 0.5 ) );
		const edge = ( i ) => btn( i ) && ! P.prev[ i ];
		const dpadLeft = edge( 14 ), a = edge( 0 ), b = edge( 1 );
		// closing waits for the button's release: the game's pad mapping comes back on close and would
		// otherwise read the still-held B as a fresh press (C)
		const released = ( i ) => ! btn( i ) && P.prev[ i ];
		const closeNow = P.closeArm && ( released( 14 ) || released( 1 ) );
		for ( let i = 0; i < pad.buttons.length; i ++ ) P.prev[ i ] = btn( i );
		if ( ! this.isOpen ) {

			P.closeArm = false;
			if ( dpadLeft && this._canOpen() ) {

				this.open();
				P.mode = true;

			}

			return;

		}

		if ( dpadLeft || b ) P.closeArm = true;
		if ( closeNow ) {

			P.closeArm = false;
			this.close( false );
			return;

		}

		if ( P.closeArm ) return;

		const ax = ( i ) => {

			const v = pad.axes[ i ] || 0, dz = 0.2;
			return Math.abs( v ) < dz ? 0 : ( v - Math.sign( v ) * dz ) / ( 1 - dz );

		};

		const lx = ax( 0 ), ly = ax( 1 ), ry = ax( 3 );
		if ( lx || ly || ry ) P.mode = true;
		const speed = 900 * dt; // px per second at full tilt
		if ( lx || ly ) this.view.panBy( - lx * Math.abs( lx ) * speed, - ly * Math.abs( ly ) * speed );
		if ( ry ) {

			this.view.zoomAt( Math.exp( - ry * 2.2 * dt ) );
			this._zoomed = true;

		}

		if ( a && P.mode ) this._clickAt( this.view.w / 2, this.view.h / 2 );

	}

	_playerPos() {

		const p = this.app.player;
		if ( p && p.position && Number.isFinite( p.position.x ) ) return { x: p.position.x, z: p.position.z };
		const c = this.app.camera;
		return c && c.position ? { x: c.position.x, z: c.position.z } : null;

	}

	_setStyle( el, prop, value ) {

		const k = '__wm_' + prop;
		if ( el[ k ] === value ) return;
		el[ k ] = value;
		el.style[ prop ] = value;

	}

	_toggle( el, cls, on ) {

		const k = '__wm_c_' + cls;
		if ( el[ k ] === on ) return;
		el[ k ] = on;
		el.classList.toggle( cls, on );

	}

	_render( dt ) {

		const V = this.view;
		if ( this._w > 0 && this._h > 0 && ( this._w !== V.w || this._h !== V.h ) ) {

			V.setSize( this._w, this._h );
			this._measureInsets();

		}

		const W = V.w, H = V.h;
		if ( this.gridEl ) {

			const step = niceScale( V.k, 160 ).metres * V.k;
			const origin = V.toScreen( 0, 0, {} );
			this._setStyle( this.gridEl, 'backgroundSize', `${ step }px ${ step }px` );
			this._setStyle( this.gridEl, 'backgroundPosition', `${ origin.x % step }px ${ origin.y % step }px` );
			const target = this.feature.markers.get( 'journal-target' );
			this.targetEl.hidden = ! target;
			this.bearingEl.style.display = target ? '' : 'none';
			if ( target ) {

				const q = V.toScreen( target.x, target.z, {} ), player = this._playerPos();
				this.targetEl.querySelector( 'b' ).textContent = target.label.replace( /^Tracked: /, '' );
				this.targetEl.querySelector( 'span' ).textContent = player ? `${ dist( Math.hypot( target.x - player.x, target.z - player.z ) ) } ${ compass( target.x - player.x, target.z - player.z ) } · plan around land` : 'Current objective';
				if ( player ) {

					const p = V.toScreen( player.x, player.z, {} );
					for ( const [ name, value ] of Object.entries( { x1: p.x, y1: p.y, x2: q.x, y2: q.y } ) ) this.bearingEl.setAttribute( name, String( value ) );

				} else this.bearingEl.style.display = 'none';

			}

		}

		// held pan keys
		if ( this._held.size && dt > 0 ) {

			let dx = 0, dy = 0;
			for ( const c of this._held ) {

				const d = PAN_KEYS[ c ];
				if ( d ) { dx += d[ 0 ]; dy += d[ 1 ]; }

			}

			if ( dx || dy ) V.panBy( dx * 700 * dt, dy * 700 * dt );

		}

		this._toggle( this.viewEl, 'is-pad', this._pad.mode );

		// the canvases: a world rect at ppm canvas px per metre, through the view
		const place = ( el, x0, z0, ppm ) => {

			const s = V.toScreen( x0, z0, this._pt );
			this._setStyle( el, 'transform', `translate(${ s.x.toFixed( 2 ) }px, ${ s.y.toFixed( 2 ) }px) scale(${ ( V.k / ppm ).toFixed( 5 ) })` );

		};

		const B = this._bake;
		if ( B ) {

			place( this.terrainCanvas, B.x0, B.z0, B.ppm );
			place( this.silCanvas, B.x0, B.z0, B.ppm );

		}

		for ( const o of this._outer ) place( o.canvas, o.bake.x0, o.bake.z0, o.bake.ppm );
		const fog = this.feature.fog;
		place( this.fogCanvas, fog.x0, fog.z0, FOG_PX / fog.cell );

		// fog and silhouettes: redrawn when the explored cells, the discoveries or the mode change
		const islands = WORLD.islands || [];
		const sandbox = this.feature.sandbox;
		let disc = sandbox ? 'S' : 'C';
		for ( const i of islands ) disc += this.feature.discovered( i.id ) ? '1' : '0';
		const fogSig = fog.version + '|' + disc;
		if ( fogSig !== this._fogSig ) {

			this._fogSig = fogSig;
			this._drawFog( islands, sandbox );

		}

		const silSig = fogSig + '|' + ( B && B.done ? 1 : 0 );
		if ( silSig !== this._silSig && B && B.done ) {

			this._silSig = silSig;
			this._drawSilhouettes( islands, sandbox );

		}

		this._renderMarks( islands );

		// scale bar, cursor readout
		const sc = niceScale( V.k, 120 );
		this._setStyle( this.scaleBar, 'width', sc.px.toFixed( 1 ) + 'px' );
		if ( this.scaleText.textContent !== sc.label ) this.scaleText.textContent = sc.label;
		this._readout();

	}

	_readout() {

		const V = this.view;
		const at = this._pad.mode ? { x: V.w / 2, y: V.h / 2 } : this._hover;
		let text = '';
		if ( at ) {

			const w = V.toWorld( at.x, at.y );
			text = `${ fmt( w.x ) }, ${ fmt( w.z ) }`;
			const p = this._playerPos();
			if ( p ) {

				const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot( dx, dz );
				if ( d > 8 ) text += ` · ${ dist( d ) } ${ compass( dx, dz ) }`;

			}

			const hgt = this._bake ? this._bake.heightAt( w.x, w.z ) : null;
			const fogged = ! this.feature.sandbox && ! this.feature.fog.revealedAt( w.x, w.z ) && ! this._charted( w.x, w.z );
			if ( hgt !== null && ! fogged ) text += hgt < 0 ? ` · ${ t( 'worldmap.depth', 'depth' ) } ${ Math.round( - hgt ) } m` : ` · ${ Math.round( hgt ) } m ${ t( 'worldmap.up', 'up' ) }`;

		} else {

			const p = this._playerPos();
			if ( p ) text = `${ t( 'worldmap.you', 'You' ) } · ${ fmt( p.x ) }, ${ fmt( p.z ) }`;

		}

		if ( this.coordsText.textContent !== text ) this.coordsText.textContent = text;
		const wp = this.feature.waypoint, p = this._playerPos();
		const sub = wp && p ? `${ t( 'worldmap.waypoint', 'Waypoint' ) } ${ dist( Math.hypot( wp.x - p.x, wp.z - p.z ) ) } ${ compass( wp.x - p.x, wp.z - p.z ) }` : '';
		const span = this.headEl.querySelector( 'span' );
		if ( span.textContent !== sub ) span.textContent = sub;

	}

	_charted( x, z ) {

		const m = this._mask, fog = this.feature.fog;
		const k = fog.index( x, z );
		return !! ( m && k >= 0 && m[ k ] );

	}

	// the fog canvas: fog everywhere, soft dots punched out over the explored and charted cells
	_drawFog( islands, sandbox ) {

		const fog = this.feature.fog, c = this.fogCanvas;
		const cw = fog.nx * FOG_PX, ch = fog.nz * FOG_PX;
		if ( c.width !== cw || c.height !== ch ) {

			c.width = cw;
			c.height = ch;
			c.style.width = cw + 'px';
			c.style.height = ch + 'px';

		}

		// charted islands (discovered) lie clear of the fog
		const circles = islands.filter( ( i ) => i && i.center && this.feature.discovered( i.id ) ).map( ( i ) => ( { x: i.center.x, z: i.center.z, r: i.radius || 0 } ) );
		this._mask = fog.circleMask( circles, this._mask );
		const ctx = c.getContext( '2d' );
		ctx.globalCompositeOperation = 'source-over';
		ctx.clearRect( 0, 0, cw, ch );
		if ( sandbox ) return;
		ctx.fillStyle = FOG_COLOR;
		ctx.fillRect( 0, 0, cw, ch );
		if ( ! this._dot ) {

			const d = this._dot = document.createElement( 'canvas' );
			d.width = d.height = 32;
			const g = d.getContext( '2d' ), gr = g.createRadialGradient( 16, 16, 0, 16, 16, 16 );
			gr.addColorStop( 0, 'rgba(0,0,0,1)' );
			gr.addColorStop( 0.55, 'rgba(0,0,0,0.9)' );
			gr.addColorStop( 1, 'rgba(0,0,0,0)' );
			g.fillStyle = gr;
			g.fillRect( 0, 0, 32, 32 );

		}

		ctx.globalCompositeOperation = 'destination-out';
		const D = FOG_PX * 2.6;
		for ( let j = 0; j < fog.nz; j ++ ) for ( let i = 0; i < fog.nx; i ++ ) {

			const k = j * fog.nx + i;
			if ( fog.cells[ k ] || this._mask[ k ] ) ctx.drawImage( this._dot, ( i + 0.5 ) * FOG_PX - D / 2, ( j + 0.5 ) * FOG_PX - D / 2, D, D );

		}

		ctx.globalCompositeOperation = 'source-over';

	}

	// islands not yet discovered: a faint pale shape (brighter coast) where the fog still lies over them
	_drawSilhouettes( islands, sandbox ) {

		const B = this._bake, c = this.silCanvas, ctx = c.getContext( '2d' );
		ctx.clearRect( 0, 0, c.width, c.height );
		if ( sandbox || ! B || ! B.h ) return;
		const n = B.n, Hh = B.h, fog = this.feature.fog, mask = this._mask;
		for ( const isl of islands ) {

			if ( ! isl || ! isl.center || this.feature.discovered( isl.id ) ) continue;
			const R = ( isl.radius || 100 ) * 1.15, cx = isl.center.x, cz = isl.center.z;
			const i0 = Math.max( 1, Math.floor( ( cx - R - B.x0 ) * B.ppm ) ), i1 = Math.min( n - 2, Math.ceil( ( cx + R - B.x0 ) * B.ppm ) );
			const j0 = Math.max( 1, Math.floor( ( cz - R - B.z0 ) * B.ppm ) ), j1 = Math.min( n - 2, Math.ceil( ( cz + R - B.z0 ) * B.ppm ) );
			if ( i1 <= i0 || j1 <= j0 ) continue;
			const w = i1 - i0 + 1, hh = j1 - j0 + 1;
			const img = ctx.createImageData( w, hh ), d = img.data;
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const k = j * n + i;
				if ( Hh[ k ] < 0 ) continue;
				const x = B.x0 + ( i + 0.5 ) / B.ppm, z = B.z0 + ( j + 0.5 ) / B.ppm;
				if ( ( x - cx ) * ( x - cx ) + ( z - cz ) * ( z - cz ) > R * R ) continue;
				const fogged = 1 - fog.softAt( mask, x, z );
				if ( fogged < 0.03 ) continue;
				const coast = Hh[ k - 1 ] < 0 || Hh[ k + 1 ] < 0 || Hh[ k - n ] < 0 || Hh[ k + n ] < 0;
				const o = ( ( j - j0 ) * w + ( i - i0 ) ) * 4;
				d[ o ] = 214; d[ o + 1 ] = 232; d[ o + 2 ] = 238;
				d[ o + 3 ] = 255 * ( coast ? 0.6 : 0.2 ) * fogged;

			}

			ctx.putImageData( img, i0, j0 );

		}

	}

	// ---- markers

	_collect( list ) {

		const app = this.app, F = this.feature, feats = app.features, g = app.game, st = g && g.state;
		const add = ( key, kind, icon, x, z, o = null ) => {

			if ( Number.isFinite( x ) && Number.isFinite( z ) ) list.push( { key, kind, icon, x, z, label: '', minor: false, edge: false, rot: null, hot: false, ...o } );

		};

		// the stalls, the yard, the ports (a port shows once its island is discovered)
		add( 'joe', 'joe', ICON.fish, STAND.x, STAND.z );
		add( 'marta', 'marta', ICON.anchor, CHANDLERY.x, CHANDLERY.z, { minor: true } );
		add( 'yard', 'yard', ICON.helm, YARD.x, YARD.z );
		if ( F.discovered( 'pons' ) ) add( 'pons', 'pons', ICON.fish, PONS_STAND.x, PONS_STAND.z );
		const pm = ( app.ports && app.ports.markers ) || [];
		// a port's sub-markers (Tidemark's 'tidemark:airstrip') show once their port (m.port) is discovered
		for ( const m of pm ) if ( F.discovered( m.port || m.id ) ) add( 'port:' + m.id, portMarkerKind( m ), m.icon === 'anchor' || m.icon === 'plane' ? ICON[ m.icon ] : ICON.fish, m.x, m.z );
		for ( const p of WORLD.ports || [] ) {

			// ports without a marker of their own (islands added later): an anchor at the stand
			if ( ! p || p.id === 'home' || p.id === 'pons' || pm.some( ( m ) => m.id === p.id ) || ! p.stand || ! F.discovered( p.id ) ) continue;
			add( 'port:' + p.id, 'pons', ICON.anchor, p.stand.x, p.stand.z );

		}

		const trade = feats && feats.get && feats.get( 'trade' );
		const sites = trade && trade.sites;
		if ( sites ) for ( const id in sites ) if ( sites[ id ] && F.discovered( id ) ) add( 'trade:' + id, 'trade', ICON.crate, sites[ id ].x, sites[ id ].z, { minor: true } );
		for ( const id in BOARD_SITES ) if ( F.discovered( id ) ) add( 'board:' + id, 'board', ICON.board, BOARD_SITES[ id ].x, BOARD_SITES[ id ].z, { minor: true } );
		add( 'camp', 'camp', ICON.swords, CAMP.x, CAMP.z );
		// a pirate island, once charted: a skull on its middle (its batteries' reach is drawn from the pirates' search zones)
		for ( const isl of WORLD.islands || [] ) if ( isl && isl.pirate && isl.center && discoveryState( ( id ) => F.discovered( id ), isl, F.sandbox ) === 'charted' ) add( 'isle:' + isl.id, 'isle', ICON.skull, isl.center.x, isl.center.z );

		// ships: pirates, and the captains the player's bounties hunt
		const naval = feats && feats.get && feats.get( 'naval' );
		const hunted = new Set();
		for ( const s of ( naval && naval.ships ) || [] ) {

			if ( ! s || ! s.alive ) continue;
			if ( s.bounty ) {

				hunted.add( s.bounty.id );
				add( 'ship:' + s.id, 'bounty', ICON.target, s.x, s.z, { label: s.bounty.captain || s.captain || s.name, hot: true, edge: true } );

			} else if ( s.faction === 'pirate' ) add( 'ship:' + s.id, 'pirate', ICON.skull, s.x, s.z );

		}

		// accepted bounties whose ship is not about: the last known region
		const notices = feats && feats.get && feats.get( 'notices' );
		const regions = this._regionList = this._regionList || [];
		regions.length = 0;
		for ( const n of ( notices && notices.active ) || [] ) {

			if ( n && n.kind === 'bounty' && n.region && ! hunted.has( n.id ) ) regions.push( { key: n.id, x: n.region.x, z: n.region.z, r: REGION_R, label: n.captain || n.target, zone: false } );

		}

		// the pirates' search zones (high-tier bounties: somewhere in this circle); the shape is read loosely, as the
		// pirates feature (src/features/pirates) may not exist yet
		const pirates = feats && feats.get && feats.get( 'pirates' );
		let zones = null;
		try { zones = pirates && typeof pirates.searchZones === 'function' ? pirates.searchZones() : null; } catch ( e ) { zones = null; }
		if ( Array.isArray( zones ) ) zones.forEach( ( zn, i ) => {

			const c = zn && ( zn.center || zn );
			if ( ! c || ! Number.isFinite( c.x ) || ! Number.isFinite( c.z ) ) return;
			const id = zn.id !== undefined ? zn.id : i;
			if ( hunted.has( id ) || regions.some( ( r ) => r.key === id ) ) return;
			const r = Number.isFinite( zn.r ) ? zn.r : Number.isFinite( zn.radius ) ? zn.radius : REGION_R;
			regions.push( { key: 'zone:' + id, x: c.x, z: c.z, r: Math.max( 10, r ), label: zn.label || zn.captain || zn.name || '', zone: true, battery: zn.kind === 'battery', silenced: !! zn.silenced } );

		} );

		// the seaplane, the boat when the player is not aboard, the other players
		const sp = feats && feats.get && feats.get( 'seaplane' );
		let pl = null;
		try { pl = sp && sp.marker ? sp.marker() : null; } catch ( e ) { pl = null; }
		const afName = sp && typeof sp.af === 'string' && sp.af ? sp.af[ 0 ].toUpperCase() + sp.af.slice( 1 ) : '';
		if ( pl ) add( 'plane', 'plane', ICON.plane, pl.x, pl.z, { rot: Number.isFinite( pl.heading ) ? yawAngle( pl.heading ) : null, label: afName } );
		const p = app.player, b = app.boatCtl;
		const helicopter = feats && feats.get && feats.get( 'helicopter' );
		let hm = null;
		try { hm = helicopter?.marker?.() || null; } catch ( e ) { hm = null; }
		const flyingHelicopter = !! ( helicopter?.piloted || ( p?.mode === 'plane' && p?.vehicle?.kind === 'helicopter' ) );
		if ( hm && ! flyingHelicopter ) add( 'helicopter', 'helicopter', HELICOPTER_ICON, hm.x, hm.z, {
			rot: Number.isFinite( hm.heading ) ? yawAngle( hm.heading ) : null,
			label: ( hm.label || t( 'worldmap.helicopter', 'Rescue helicopter' ) ) + ( helicopter?.flight?.grounded ? ' · ' + t( 'worldmap.parkedHelicopter', 'parked' ) : '' ), edge: true,
		} );
		if ( st && st.boat && b && b.position && ! ( p && [ 'boat', 'deck', 'seat' ].includes( p.mode ) ) ) {

			const crew = feats && feats.get && feats.get( 'crew' ), n = crew && crew.posts ? Object.keys( crew.posts ).length : 0;
			add( 'boat', 'boat', ICON.boat, b.position.x, b.position.z, n ? { label: `${ n } ${ t( 'worldmap.crew', 'crew' ) }` } : null );

		}
		const peers = app.remotePlayers && app.remotePlayers.peers;
		if ( peers ) for ( const q of peers.values() ) {

			if ( ! q || ! q.hasPose || ! q.pose || ! q.pose.position ) continue;
			const sea = SEA_MODES.includes( q.pose.mode ) && q.pose.mode !== 'swim';
			add( 'peer:' + q.id, sea ? 'peer is-boat' : 'peer', '', q.pose.position.x, q.pose.position.z, { label: q.name || '?' } );

		}

		// the waypoint and the player: always on the map (on its edge with an arrow when out of view)
		const wp = F.waypoint;
		if ( wp ) add( 'wp', 'wp', ICON.flag, wp.x, wp.z, { edge: true } );
		const me = flyingHelicopter && hm && Number.isFinite( hm.x ) && Number.isFinite( hm.z ) ? hm : this._playerPos();
		if ( me ) {

			const cam = app.camera;
			let rot = 0;
			if ( cam && cam.matrixWorld ) {

				const e = cam.matrixWorld.elements;
				const fx = - e[ 8 ], fz = - e[ 10 ];
				if ( Math.hypot( fx, fz ) > 1e-4 ) rot = viewAngle( fx, fz );

			}

			if ( flyingHelicopter ) {

				if ( hm && Number.isFinite( hm.heading ) ) rot = yawAngle( hm.heading );
				add( 'me', 'me is-helicopter', HELICOPTER_ICON, me.x, me.z, { rot, edge: true, label: t( 'worldmap.helicopterPilot', 'You · rescue helicopter' ) } );

			} else add( 'me', 'me', ICON.arrow, me.x, me.z, { rot, edge: true } );

		}

	}

	_renderMarks( islands ) {

		const V = this.view, W = V.w, H = V.h, frame = ++ this._frame;
		const list = this._list = this._list || [];
		list.length = 0;
		this._collect( list );

		// island names, or "?" for the ones still to find
		for ( const isl of islands ) {

			if ( ! isl || ! isl.center ) continue;
			let pl = this._places.get( isl.id );
			if ( ! pl ) {

				pl = { el: h( 'div', 'wm-place', '<span></span>' ), text: null, unknown: null };
				pl.span = pl.el.firstChild;
				this.marksEl.prepend( pl.el );
				this._places.set( isl.id, pl );

			}

			const known = discoveryState( ( id ) => this.feature.discovered( id ), isl, this.feature.sandbox ) === 'charted';
			const text = known ? this._islandName( isl ) : '?';
			if ( pl.text !== text ) {

				pl.text = text;
				pl.span.textContent = text;

			}

			this._toggle( pl.el, 'is-unknown', ! known );
			const r = ( isl.radius || 0 ) * V.k;
			// a name sits a little north of the middle (clear of the port markers); hidden while the island is a dot
			const s = V.toScreen( isl.center.x, isl.center.z - ( known ? ( isl.radius || 0 ) * 0.35 : 0 ), this._pt );
			const show = s.x > - 200 && s.x < W + 200 && s.y > - 60 && s.y < H + 60 && ( ! known || r > 26 );
			this._setStyle( pl.el, 'display', show ? '' : 'none' );
			if ( show ) this._setStyle( pl.el, 'transform', `translate(${ s.x.toFixed( 1 ) }px, ${ s.y.toFixed( 1 ) }px)` );

		}

		// bounty regions
		for ( const rg of this._regionList || [] ) {

			let e = this._regions.get( rg.key );
			if ( ! e ) {

				e = { el: h( 'div', 'wm-region' + ( rg.zone ? ' is-zone' : '' ) + ( rg.battery ? ' is-battery' : '' ), '<em></em>' ), label: null };
				this.marksEl.prepend( e.el );
				this._regions.set( rg.key, e );

			}

			e.seen = frame;
			const tag = rg.battery ? ( rg.silenced ? t( 'worldmap.silenced', 'silenced' ) : t( 'worldmap.batteryReach', 'battery reach' ) ) : rg.zone ? t( 'worldmap.searchZone', 'Search zone' ) : t( 'worldmap.lastSeen', 'last seen' );
			const label = rg.label ? `${ rg.label } · ${ tag.toLowerCase() }` : tag;
			if ( e.label !== label ) {

				e.label = label;
				e.el.firstChild.textContent = label;

			}

			this._toggle( e.el, 'is-silenced', !! rg.silenced );
			const s = V.toScreen( rg.x, rg.z, this._pt ), d = Math.max( 18, ( rg.r || REGION_R ) * 2 * V.k );
			this._setStyle( e.el, 'display', '' );
			this._setStyle( e.el, 'width', d.toFixed( 1 ) + 'px' );
			this._setStyle( e.el, 'height', d.toFixed( 1 ) + 'px' );
			this._setStyle( e.el, 'transform', `translate(${ ( s.x - d / 2 ).toFixed( 1 ) }px, ${ ( s.y - d / 2 ).toFixed( 1 ) }px)` );

		}

		for ( const [ key, e ] of this._regions ) if ( e.seen !== frame ) {

			e.el.remove();
			this._regions.delete( key );

		}

		// badges
		for ( const it of list ) {

			let m = this._marks.get( it.key );
			if ( ! m ) {

				m = { el: h( 'div', 'gm-mk', '<b></b><i></i><em></em>' ), kind: null, icon: null, label: null };
				m.b = m.el.children[ 0 ];
				m.i = m.el.children[ 1 ];
				m.em = m.el.children[ 2 ];
				this.marksEl.append( m.el );
				this._marks.set( it.key, m );

			}

			m.seen = frame;
			if ( m.kind !== it.kind ) {

				m.kind = it.kind;
				m.el.className = 'gm-mk is-' + it.kind;
				m.el.__wm_c_ = undefined;
				for ( const k in m.el ) if ( k.startsWith( '__wm_c_' ) ) m.el[ k ] = undefined;

			}

			if ( m.icon !== it.icon ) {

				m.icon = it.icon;
				m.i.innerHTML = it.icon;
				m.svg = m.i.firstElementChild;

			}

			if ( m.label !== it.label ) {

				m.label = it.label;
				m.em.textContent = it.label;
				m.em.style.display = it.label ? '' : 'none';

			}

			const hide = it.minor && V.k < MINOR_K;
			const s = V.toScreen( it.x, it.z, this._pt );
			let x = s.x, y = s.y, edge = false, angle = 0;
			if ( it.edge ) {

				const c = edgeClamp( s.x, s.y, W, H, 24 );
				x = c.x; y = c.y; edge = c.edge; angle = c.angle;

			}

			const off = ! it.edge && ( x < - 30 || x > W + 30 || y < - 30 || y > H + 30 );
			this._setStyle( m.el, 'display', hide || off ? 'none' : '' );
			if ( hide || off ) continue;
			this._setStyle( m.el, 'transform', `translate(${ x.toFixed( 1 ) }px, ${ y.toFixed( 1 ) }px)` );
			this._toggle( m.el, 'is-edge', edge );
			this._toggle( m.el, 'is-hot', !! it.hot );
			if ( edge ) this._setStyle( m.b, 'transform', `rotate(${ angle.toFixed( 3 ) }rad)` );
			if ( m.svg && it.rot !== null ) this._setStyle( m.svg, 'transform', `rotate(${ it.rot.toFixed( 3 ) }rad)` );

		}

		for ( const [ key, m ] of this._marks ) if ( m.seen !== frame ) {

			m.el.remove();
			this._marks.delete( key );

		}

	}

	_islandName( isl ) {

		if ( isl.name ) return isl.name;
		if ( isl.id === 'home' ) return t( 'worldmap.home', 'Hyptile Island' );
		const port = ( WORLD.ports || [] ).find( ( p ) => p.id === isl.id );
		return port && port.name ? port.name : isl.id;

	}

	dispose() {

		this.close( false );
		if ( this._ro ) this._ro.disconnect();
		window.removeEventListener( 'keyup', this._onKeyUp );
		window.removeEventListener( 'blur', this._onBlur );
		this.el.remove();

	}

}
