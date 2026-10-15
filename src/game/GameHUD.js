import { FISH, fishLengthCm } from './FishTable.js';
import { MarkerGauge } from './CatchMinigame.js';
import { UPGRADES, nextLevel, gearGate, FUEL_PRICE } from './Gear.js';
import { FishPortrait } from './FishPortrait.js';
import { installHudPanels, touchOn, closeLabel, leaveLabel } from './HudPanels.js';
import { GOODS } from '../features/trade/goods.js';
import { t } from '../i18n/index.js';

// DOM for the fishing game, in the look of the rest of the HUD (ui/ui.css tokens, .tw-glass):
//   top right     purse and cooler / hold load
//   bottom centre the fight: line tension with its safe band, the fish's stamina, line out
//   centre        "!" when a fish takes the bait
//   panels        inventory (I / Tab) and the fish stand's offer
//   catch card    full screen: the world dims and blurs, the fish lies side-on in its own studio light
//                 (FishPortrait) with the species above and length, weight, value, record below
// Wave 20D: the strings are t( key, English ) (src/i18n; the game is English only); on touch the catch card says "Tap to
// continue" and the cooler's Close drops its key glyph.
const CSS = /* css */`
.gm-purse { position: absolute; top: var(--tw-edge); right: var(--tw-edge); display: flex; gap: var(--tw-3); align-items: center;
	padding: var(--tw-2) var(--tw-4); border-radius: 999px; font: 500 var(--tw-fs-lg) var(--tw-font); color: var(--tw-ink); pointer-events: none;
	transition: transform var(--tw-med) var(--tw-ease), right var(--tw-slow) var(--tw-ease); }
.tw-root[data-panel='open'] .gm-purse { right: calc(var(--tw-panel-w) + 2 * var(--tw-3)); }
.tw-root.is-photo .gm-panel { display: none; }
.gm-purse.is-bump { animation: gm-bump 420ms var(--tw-ease); }
@keyframes gm-bump { 30% { transform: scale(1.08); } }
.gm-money { font-family: var(--tw-mono); color: var(--tw-sun); font-weight: 600; }
.gm-cooler { display: flex; align-items: center; gap: var(--tw-2); color: var(--tw-ink-2); font-size: var(--tw-fs-md); }
.gm-cooler-bar { width: calc(64 * var(--tw-u)); height: calc(5 * var(--tw-u)); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.gm-cooler-bar > span { display: block; height: 100%; width: 0; background: var(--tw-aqua); border-radius: inherit; transition: width var(--tw-med) var(--tw-ease); }
.gm-cooler.is-full .gm-cooler-bar > span { background: var(--tw-coral); }
.gm-fight { position: absolute; left: 50%; bottom: calc(max(calc(72 * var(--tw-u)), 13vh) + calc(58 * var(--tw-u))); transform: translateX(-50%);
	width: calc(360 * var(--tw-u)); padding: var(--tw-3) var(--tw-4); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; transition: opacity var(--tw-med) var(--tw-ease); pointer-events: none; }
.gm-fight.is-on { opacity: 1; }
.gm-fight-head { display: flex; justify-content: space-between; margin-bottom: var(--tw-2); }
.gm-fight-call { font-weight: 600; letter-spacing: 0.02em; }
.gm-fight-call.is-warn { color: var(--tw-coral); }
.gm-fight-call.is-good { color: var(--tw-aqua); }
.gm-fight-dist { font-family: var(--tw-mono); color: var(--tw-ink-2); }
.gm-tension { position: relative; height: calc(12 * var(--tw-u)); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.gm-band { position: absolute; top: 0; bottom: 0; background: rgba(var(--tw-aqua-rgb), 0.28); border-left: 1px solid rgba(var(--tw-aqua-rgb), 0.6); border-right: 1px solid rgba(var(--tw-aqua-rgb), 0.6); }
.gm-danger { position: absolute; top: 0; bottom: 0; right: 0; width: 8%; background: rgba(255, 122, 133, 0.35); }
.gm-needle { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--tw-ink); box-shadow: 0 0 8px rgba(255,255,255,0.6); }
.gm-needle.is-hot { background: var(--tw-coral); box-shadow: 0 0 10px var(--tw-coral); }
.gm-stamina { margin-top: var(--tw-2); display: flex; align-items: center; gap: var(--tw-2); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.gm-stamina-bar { flex: 1; height: calc(4 * var(--tw-u)); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.gm-stamina-bar > span { display: block; height: 100%; background: var(--tw-sun); }
.gm-bite { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%) scale(0.6); font: 800 calc(56 * var(--tw-u)) var(--tw-font);
	color: var(--tw-sun); text-shadow: 0 0 18px rgba(var(--tw-sun-rgb), 0.8), 0 2px 4px rgba(0,0,0,0.5); opacity: 0; pointer-events: none;
	transition: opacity 120ms, transform 200ms var(--tw-ease); }
.gm-bite.is-on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.gm-cast { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); width: calc(140 * var(--tw-u)); height: calc(5 * var(--tw-u));
	border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; opacity: 0; transition: opacity var(--tw-fast); pointer-events: none; }
.gm-cast.is-on { opacity: 1; }
.gm-cast > span { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--tw-aqua), var(--tw-sun)); }
.gm-dot { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: rgba(255,255,255,0.7); box-shadow: 0 0 3px rgba(0,0,0,0.6); opacity: 0; pointer-events: none; }
.gm-dot.is-on { opacity: 1; }
.gm-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); width: calc(420 * var(--tw-u)); max-height: 70vh; display: flex; flex-direction: column;
	padding: var(--tw-4) var(--tw-5); border-radius: var(--tw-r-lg); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); }
.gm-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.gm-panel h2 { margin: 0 0 var(--tw-1); font-size: calc(17 * var(--tw-u)); font-weight: 600; }
.gm-panel p.gm-sub { margin: 0 0 var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.gm-list { overflow: auto; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2); }
.gm-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: var(--tw-3); align-items: center; padding: var(--tw-2) 0; border-bottom: 1px solid var(--tw-line); }
.gm-row .gm-kg, .gm-row .gm-val { font-family: var(--tw-mono); color: var(--tw-ink-2); }
.gm-row .gm-val { color: var(--tw-sun); }
.gm-row small { color: var(--tw-aqua); margin-left: var(--tw-1); }
.gm-empty { color: var(--tw-ink-3); padding: var(--tw-4) 0; text-align: center; }
.gm-foot { display: flex; justify-content: space-between; align-items: center; margin-top: var(--tw-3); gap: var(--tw-3); }
.gm-btn { font: 600 var(--tw-fs-md) var(--tw-font); color: #0b1418; background: var(--tw-aqua); border: 0; border-radius: 999px; padding: var(--tw-2) var(--tw-4); cursor: pointer; }
.gm-btn[disabled] { opacity: 0.4; cursor: default; }
.gm-btn.is-ghost { background: var(--tw-fill-2); color: var(--tw-ink); }
.gm-mini { font: 500 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink-2); background: var(--tw-fill); border: 1px solid var(--tw-line); border-radius: 999px; padding: 2px var(--tw-2); cursor: pointer; }
.gm-gauge { display: none; align-items: center; gap: var(--tw-2); color: var(--tw-ink-2); font-size: var(--tw-fs-md); }
.gm-gauge.is-on { display: flex; }
.gm-gauge b { font-family: var(--tw-mono); font-weight: 500; color: var(--tw-ink); }
.gm-fuel-bar > span { background: var(--tw-sun); }
.gm-fuel.is-low .gm-fuel-bar > span { background: var(--tw-coral); }
.gm-stam-bar > span { background: var(--tw-aqua); }
.gm-stam.is-low .gm-stam-bar > span { background: var(--tw-coral); }
.gm-sonar-dots { letter-spacing: 1px; color: var(--tw-aqua); }
.gm-shop-row { display: grid; grid-template-columns: 1fr auto; gap: var(--tw-3); align-items: center; padding: var(--tw-2) 0; border-bottom: 1px solid var(--tw-line); }
.gm-shop-row small { display: block; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); margin-top: 2px; }
.gm-shop-row .gm-have { color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.gm-log { margin-top: var(--tw-3); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); line-height: 1.5; }
.gm-row .gm-cm { font-family: var(--tw-mono); color: var(--tw-ink-3); }
.gm-row.has-cm { grid-template-columns: 1fr auto auto auto auto; }

.gm-tabs { display: flex; gap: var(--tw-1); margin: 0 0 var(--tw-3); padding: 2px; border-radius: 999px; background: var(--tw-fill); align-self: flex-start; }
.gm-tab { font: 500 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink-3); background: transparent; border: 0; border-radius: 999px; padding: 2px var(--tw-3); cursor: pointer; }
.gm-tab.is-on { color: var(--tw-ink); background: var(--tw-fill-2); }
.gm-hold-wrap { overflow: auto; margin: 0 calc(-1 * var(--tw-2)); padding: 0 var(--tw-2) var(--tw-1); }
.gm-hold { position: relative; display: grid; grid-template-columns: repeat(var(--gm-cols, 6), 1fr); grid-auto-rows: calc(52 * var(--tw-u)); gap: 3px; }
.gm-cell { border-radius: 6px; background: var(--tw-fill); box-shadow: inset 0 0 0 1px var(--tw-line); }
.gm-cell.is-locked { background: transparent; box-shadow: inset 0 0 0 1px rgba(255, 122, 133, 0.28); }
.gm-block { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 2px calc(6 * var(--tw-u)); border-radius: 6px; cursor: grab;
	color: #0b1418; background: var(--gm-c, #7fb4c8); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35), 0 2px 5px rgba(0, 0, 0, 0.3); overflow: hidden; -webkit-user-select: none; user-select: none; }
.gm-block:active { cursor: grabbing; }
.gm-block.is-drag { opacity: 0.35; }
.gm-block b { font: 600 var(--tw-fs-xs) var(--tw-font); line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gm-block i { font: 500 var(--tw-fs-xs) var(--tw-mono); font-style: normal; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gm-block.is-1 i { display: none; }
.gm-block.is-fish.is-t0 { --gm-c: #8fa9b8; }
.gm-block.is-fish.is-t1 { --gm-c: #6fc2c9; }
.gm-block.is-fish.is-t2 { --gm-c: #7fd08a; }
.gm-block.is-fish.is-t3 { --gm-c: #f0c46a; }
.gm-block.is-fish.is-t4 { --gm-c: #ff8f7a; }
.gm-block.is-crate { --gm-c: var(--gm-crate, #c9a86a); background: repeating-linear-gradient(135deg, var(--gm-c) 0 7px, color-mix(in srgb, var(--gm-c) 82%, #000) 7px 9px);
	box-shadow: inset 0 0 0 2px rgba(60, 40, 20, 0.45), 0 2px 5px rgba(0, 0, 0, 0.3); }
.gm-ghost { z-index: 2; border-radius: 6px; pointer-events: none; }
.gm-ghost.is-ok { box-shadow: inset 0 0 0 2px rgba(var(--tw-aqua-rgb), 0.9); background: rgba(var(--tw-aqua-rgb), 0.18); }
.gm-ghost.is-bad { box-shadow: inset 0 0 0 2px rgba(255, 122, 133, 0.9); background: rgba(255, 122, 133, 0.14); }
.gm-hold-key { display: flex; flex-wrap: wrap; gap: var(--tw-1) var(--tw-3); margin-top: var(--tw-2); color: var(--tw-ink-3); font-size: var(--tw-fs-xs); }
.gm-hold-key span::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 2px; background: var(--k, transparent); vertical-align: -1px; }

/* catch card: full screen. The world dims and blurs; the fish lies side-on in its own studio light
   (FishPortrait, a WebGPU canvas) between the name above and the numbers below */
.gm-catch-scrim { position: absolute; inset: 0; pointer-events: none; opacity: 0; visibility: hidden;
	background: radial-gradient(70% 60% at 50% 50%, rgba(10, 22, 34, 0.55) 0%, rgba(4, 9, 15, 0.86) 100%);
	-webkit-backdrop-filter: blur(10px) saturate(0.8); backdrop-filter: blur(10px) saturate(0.8);
	transition: opacity 420ms var(--tw-ease), visibility 0s linear 420ms; }
.gm-catch-scrim.is-on { opacity: 1; visibility: visible; transition: opacity 420ms var(--tw-ease), visibility 0s; }
.gm-catch { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(6px, 1.4vh, 18px);
	padding: var(--tw-6) var(--tw-edge); color: #f4ead6; font: 500 var(--tw-fs-md) var(--tw-font); text-align: center;
	pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 300ms var(--tw-ease), visibility 0s linear 300ms; }
.gm-catch.is-on { opacity: 1; visibility: visible; transition: opacity 300ms var(--tw-ease), visibility 0s; }
.gm-catch-top, .gm-catch-bottom { display: flex; flex-direction: column; align-items: center; opacity: 0; }
.gm-catch.is-on .gm-catch-top { animation: gm-rise 700ms var(--tw-ease) 120ms forwards; }
.gm-catch.is-on .gm-catch-bottom { animation: gm-rise 700ms var(--tw-ease) 520ms forwards; }
@keyframes gm-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.gm-catch-eyebrow { display: flex; align-items: center; justify-content: center; min-height: calc(26 * var(--tw-u)); margin-bottom: var(--tw-2);
	font-size: var(--tw-fs-sm); font-weight: 700; letter-spacing: 0.32em; text-transform: uppercase; color: rgba(244, 234, 214, 0.62); }
.gm-badge { display: inline-flex; align-items: center; gap: 0.5em; padding: calc(4 * var(--tw-u)) calc(12 * var(--tw-u)); border-radius: 4px;
	letter-spacing: 0.22em; font-weight: 800; transform: scale(2.4) rotate(-8deg); opacity: 0; }
.gm-catch.is-on .gm-badge { animation: gm-stamp 520ms cubic-bezier(0.3, 1.5, 0.5, 1) 900ms forwards; }
.gm-badge.is-record { color: #2a1604; background: linear-gradient(100deg, #f3cf8a 0%, #d9a441 40%, #fff0cf 50%, #d9a441 60%, #f3cf8a 100%); background-size: 250% 100%;
	box-shadow: 0 0 0 2px rgba(42, 22, 4, 0.35) inset, 0 0 26px rgba(217, 164, 65, 0.55); }
.gm-catch.is-on .gm-badge.is-record { animation: gm-stamp 520ms cubic-bezier(0.3, 1.5, 0.5, 1) 900ms forwards, gm-shine 2.6s var(--tw-ease-io) 1.6s infinite; }
.gm-badge.is-new { color: #062420; background: #6fd6c6; box-shadow: 0 0 0 2px rgba(6, 36, 32, 0.3) inset, 0 0 22px rgba(111, 214, 198, 0.45); }
.gm-badge.is-plain { color: rgba(244, 234, 214, 0.8); background: none; box-shadow: inset 0 0 0 1px rgba(244, 234, 214, 0.35); }
@keyframes gm-stamp { 0% { transform: scale(2.4) rotate(-8deg); opacity: 0; } 70% { transform: scale(0.94) rotate(-3deg); opacity: 1; } 100% { transform: scale(1) rotate(-3deg); opacity: 1; } }
@keyframes gm-shine { 0% { background-position: 100% 0; } 100% { background-position: -150% 0; } }
.gm-catch h2 { margin: 0; font-family: 'Caveat Brush', 'Kalam', var(--tw-font); font-weight: 400; font-size: clamp(38px, 6.2vw, 92px); line-height: 1; letter-spacing: 0.01em;
	color: #fbf1dc; text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35), 0 8px 30px rgba(0, 0, 0, 0.45); }
.gm-catch-sci { margin-top: calc(4 * var(--tw-u)); font-family: 'Kalam', var(--tw-font); font-style: italic; color: rgba(244, 234, 214, 0.66); font-size: clamp(13px, 1.3vw, 19px); }
.gm-catch-stage { position: relative; width: min(94vw, 1400px, calc(46vh * 2.4)); aspect-ratio: 2.4 / 1; }
.gm-catch-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%;
	-webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%); mask-image: linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%); }
/* the card owns the screen: the minimap and the settings rail step aside */
.tw-root:has(.gm-catch.is-on) .gm-map, .tw-root:has(.gm-catch.is-on) .tw-rail { opacity: 0; pointer-events: none; transition: opacity 300ms; }
.gm-catch-stage::before { content: ''; position: absolute; left: 12%; right: 12%; bottom: 6%; height: 16%; border-radius: 50%;
	background: radial-gradient(closest-side, rgba(0, 0, 0, 0.5), transparent); opacity: 0; }
.gm-catch.is-on .gm-catch-stage::before { animation: gm-fade 900ms var(--tw-ease) 350ms forwards; }
@keyframes gm-fade { to { opacity: 1; } }
.gm-splash { position: absolute; left: 50%; top: 52%; width: 0; height: 0; pointer-events: none; }
.gm-splash i { position: absolute; left: 0; top: 0; width: var(--s); height: var(--s); margin: calc(var(--s) / -2); border-radius: 50%;
	background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.95), rgba(190, 235, 245, 0.55) 55%, transparent 72%); opacity: 0; }
.gm-catch.is-on .gm-splash i { animation: gm-drop 1100ms cubic-bezier(0.2, 0.7, 0.3, 1) var(--d) forwards; }
@keyframes gm-drop { 0% { opacity: 0; transform: translate(0, 0) scale(0.4); } 12% { opacity: 1; }
	100% { opacity: 0; transform: translate(var(--x), var(--y)) scale(1); } }
.gm-catch-stats { display: flex; justify-content: center; gap: clamp(8px, 1.6vw, 22px); margin-top: var(--tw-2); }
.gm-stat { min-width: clamp(96px, 11vw, 150px); padding: calc(10 * var(--tw-u)) calc(16 * var(--tw-u)) calc(9 * var(--tw-u)); border-radius: 6px;
	background: linear-gradient(180deg, rgba(232, 220, 192, 0.12), rgba(232, 220, 192, 0.05)); box-shadow: inset 0 0 0 1px rgba(214, 180, 110, 0.38), 0 10px 30px rgba(0, 0, 0, 0.25); }
.gm-stat span { display: block; font-size: var(--tw-fs-xs); font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(222, 190, 125, 0.9); }
.gm-stat b { display: block; margin-top: calc(4 * var(--tw-u)); font: 600 clamp(20px, 2.2vw, 32px) var(--tw-mono); color: #fbf1dc; white-space: nowrap; }
.gm-stat b small { font-size: 0.55em; font-weight: 500; color: rgba(244, 234, 214, 0.7); margin-left: 0.2em; }
.gm-stat i { display: block; white-space: nowrap; font-style: normal; font-family: var(--tw-mono); font-size: var(--tw-fs-sm); color: rgba(244, 234, 214, 0.5); margin-top: 2px; }
.gm-stat.is-value b { color: #f0c46a; }
.gm-catch-note { margin-top: var(--tw-3); min-height: 1.4em; color: rgba(244, 234, 214, 0.78); font-family: 'Kalam', var(--tw-font); font-size: clamp(14px, 1.25vw, 19px); line-height: 1.4; }
.gm-catch-note b { color: #f0c46a; font-weight: 700; }
.gm-catch-note.is-warn { color: #ff9a8a; }
.gm-catch-foot { display: flex; align-items: center; justify-content: center; gap: var(--tw-2); margin-top: var(--tw-3); color: rgba(244, 234, 214, 0.5); font-size: var(--tw-fs-sm); }
.gm-catch-foot kbd { font: 600 var(--tw-fs-xs) var(--tw-mono); color: #f4ead6; padding: 2px calc(6 * var(--tw-u)); border-radius: 4px; border: 1px solid rgba(244, 234, 214, 0.3); background: rgba(244, 234, 214, 0.08); }
.gm-catch-timer { width: calc(80 * var(--tw-u)); height: 2px; margin-left: var(--tw-2); border-radius: 2px; background: rgba(244, 234, 214, 0.15); overflow: hidden; }
.gm-catch-timer > span { display: block; height: 100%; width: 100%; background: rgba(244, 234, 214, 0.55); transform-origin: 0 50%; }
.gm-catch.is-on .gm-catch-timer > span { animation: gm-timer var(--gm-catch-ms, 9000ms) linear forwards; }
@keyframes gm-timer { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) {
	.gm-catch.is-on .gm-catch-top, .gm-catch.is-on .gm-catch-bottom { animation: none; opacity: 1; }
	.gm-catch.is-on .gm-badge, .gm-catch.is-on .gm-badge.is-record { animation: none; transform: rotate(-3deg); opacity: 1; }
	.gm-catch.is-on .gm-splash i { animation: none; }
}
@media (max-width: 640px) {
	.gm-catch-stage { width: 96vw; }
	.gm-catch-stats { gap: 6px; }
	.gm-stat { min-width: 0; padding: 8px 10px; }
}
`;

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

// ---- the hold grid: the Unreal game's 6 x 4 cargo grid, over the weight-based hold
//
// The hold is a grid of HOLD_COLS columns. One cell stands for holdCellKg( hold ) kg of fish (5 kg on a big hold, less on
// the small cooler so its grid still has a few rows) plus one cell per crate of trade cargo the boat can carry. A fish is
// a block of 1 to 4 cells by its weight (1, 2, 3 in a row, 4 as 2 x 2), coloured by its value; a trade crate is one cell
// (two for bulky goods) in its good's colour. The grid is a view: the hold itself stays weight-based. Many tiny fish can
// need more cells than the hold has: the grid then grows an overflow row, it never refuses a fish the cooler accepts.
// Blocks are dragged with the mouse; where each one sits is kept in localStorage (no GameState method reorders the
// inventory), per save slot, and a block whose saved place no longer fits falls back to the first free spot.
export const HOLD_COLS = 6;
const HOLD_KEY = 'alpha-astra.hold.v1';
const VIEW_KEY = 'alpha-astra.inventory-view';

export function holdCellKg( holdKg ) {

	return Math.min( 5, Math.max( 1, ( Number( holdKg ) || 0 ) / 24 ) );

}

// cells a fish of `kg` takes (1..4)
export function fishCells( kg, cellKg = 5 ) {

	return Math.max( 1, Math.min( 4, Math.ceil( kg / cellKg - 1e-9 ) ) );

}

export function cellShape( n ) {

	return n >= 4 ? { w: 2, h: 2 } : { w: Math.max( 1, n ), h: 1 };

}

// 0 (cheap) .. 4 (a prize), by the fish's $ value
export function valueTier( value ) {

	const v = Number( value ) || 0;
	return v < 8 ? 0 : v < 25 ? 1 : v < 70 ? 2 : v < 180 ? 3 : 4;

}

// total cells of the grid: the fish hold plus the crate capacity of the boat
export function holdCells( holdKg, crateCapacity = 0 ) {

	return Math.max( 1, Math.ceil( ( Number( holdKg ) || 0 ) / holdCellKg( holdKg ) - 1e-9 ) ) + Math.max( 0, crateCapacity | 0 );

}

// the blocks to draw: every fish in the cooler, then every trade crate (one block per unit of cargo)
export function holdItems( state, trade = null ) {

	const items = [];
	const cellKg = holdCellKg( state.stats.holdKg );
	for ( const f of state.inventory ) {

		const sp = FISH[ f.species ];
		const n = fishCells( f.kg, cellKg ), shape = cellShape( n );
		const cm = f.cm ?? Math.round( fishLengthCm( f.species, f.kg ) );
		items.push( { key: `f:${ f.id }`, kind: 'fish', id: f.id, w: shape.w, h: shape.h, cells: n, label: sp ? sp.name : f.species, sub: `${ f.kg.toFixed( 1 ) } kg`,
			tier: valueTier( f.value ), color: null, title: `${ sp ? sp.name : f.species }${ f.record ? ' (record)' : '' }: ${ cm } cm, ${ f.kg.toFixed( 2 ) } kg, $${ f.value }` } );

	}

	const cargo = trade && trade.cargo ? trade.cargo : null;
	if ( cargo ) for ( const g of Object.keys( cargo ).sort() ) {

		const c = cargo[ g ];
		const info = GOODS[ g ] || null;
		const per = c.qty > 0 ? Math.max( 1, Math.round( c.crates / c.qty ) ) : 1;
		for ( let i = 0; i < c.qty; i ++ ) {

			items.push( { key: `c:${ g }:${ i }`, kind: 'crate', good: g, w: Math.min( HOLD_COLS, per ), h: 1, cells: per, label: info ? info.name : g, sub: info ? info.unit : 'crate',
				tier: - 1, color: info ? info.color : '#c9a86a', cond: c.cond, title: `${ info ? info.name : g }: 1 ${ info ? info.unit : 'crate' }, ${ Math.round( c.cond * 100 ) }% condition` } );

		}

	}

	return items;

}

// Places the items. pos is { key: [ x, y ] } (a saved place); an item whose place is out of the grid or taken goes where it
// first fits, scanning row by row. Returns { blocks: [ { item, x, y, w, h } ], rows, baseRows, over }.
export function layoutHold( items, { cols = HOLD_COLS, cells = 24, pos = {} } = {} ) {

	const baseRows = Math.max( 1, Math.ceil( cells / cols ) );
	const taken = new Set();
	const free = ( x, y, w, h ) => {

		if ( x < 0 || y < 0 || x + w > cols ) return false;
		for ( let j = 0; j < h; j ++ ) for ( let i = 0; i < w; i ++ ) if ( taken.has( ( y + j ) * cols + x + i ) ) return false;
		return true;

	};

	const put = ( x, y, w, h ) => { for ( let j = 0; j < h; j ++ ) for ( let i = 0; i < w; i ++ ) taken.add( ( y + j ) * cols + x + i ); };
	const blocks = new Map();
	for ( const it of items ) {

		const p = pos[ it.key ];
		if ( ! Array.isArray( p ) ) continue;
		const x = p[ 0 ] | 0, y = p[ 1 ] | 0;
		if ( y + it.h <= baseRows && free( x, y, it.w, it.h ) ) { put( x, y, it.w, it.h ); blocks.set( it.key, { item: it, x, y, w: it.w, h: it.h } ); }

	}

	for ( const it of items ) {

		if ( blocks.has( it.key ) ) continue;
		let placed = false;
		for ( let y = 0; ! placed && y < 4096; y ++ ) for ( let x = 0; x + it.w <= cols; x ++ ) if ( free( x, y, it.w, it.h ) ) {

			put( x, y, it.w, it.h );
			blocks.set( it.key, { item: it, x, y, w: it.w, h: it.h } );
			placed = true;
			break;

		}

	}

	let rows = baseRows;
	for ( const b of blocks.values() ) rows = Math.max( rows, b.y + b.h );
	return { blocks: items.map( ( it ) => blocks.get( it.key ) ).filter( Boolean ), rows, baseRows, cols, over: rows > baseRows, canPlace: free };

}

// can `item` sit at ( x, y ) with every other block where it is? (the move a drag asks for)
export function canMoveTo( layout, key, x, y ) {

	const me = layout.blocks.find( ( b ) => b.item.key === key );
	if ( ! me || x < 0 || y < 0 || x + me.w > layout.cols || y + me.h > layout.rows ) return false;
	for ( const b of layout.blocks ) {

		if ( b === me ) continue;
		if ( x < b.x + b.w && b.x < x + me.w && y < b.y + b.h && b.y < y + me.h ) return false;

	}

	return true;

}

function loadHoldPos( storage, slotKey ) {

	try {

		const all = JSON.parse( storage.getItem( HOLD_KEY ) || '{}' );
		const p = all && all[ slotKey ];
		return p && typeof p === 'object' ? p : {};

	} catch ( e ) {

		return {};

	}

}

function saveHoldPos( storage, slotKey, layout ) {

	try {

		const all = JSON.parse( storage.getItem( HOLD_KEY ) || '{}' ) || {};
		const p = {};
		for ( const b of layout.blocks ) p[ b.item.key ] = [ b.x, b.y ];
		all[ slotKey ] = p;
		storage.setItem( HOLD_KEY, JSON.stringify( all ) );

	} catch ( e ) { /* no storage */ }

}

// Builds the grid into `box` (cleared first): the empty cells, then the blocks over them as grid items. Dragging a block
// with the mouse moves it (onMove( key, x, y ) when the drop fits). Returns the layout.
export function buildHoldGrid( box, layout, { total = 0, onMove = null, onDrag = null } = {} ) {

	box.innerHTML = '';
	box.style.setProperty( '--gm-cols', String( layout.cols ) );
	const cellOf = ( x, y ) => {

		const c = document.createElement( 'div' );
		c.className = 'gm-cell' + ( y * layout.cols + x >= total ? ' is-locked' : '' );
		c.style.gridColumn = `${ x + 1 }`;
		c.style.gridRow = `${ y + 1 }`;
		return c;

	};

	for ( let y = 0; y < layout.rows; y ++ ) for ( let x = 0; x < layout.cols; x ++ ) box.appendChild( cellOf( x, y ) );
	const ghost = document.createElement( 'div' );
	ghost.className = 'gm-ghost';
	ghost.hidden = true;
	box.appendChild( ghost );
	let drag = null; // { key, dx, dy } the grabbed cell inside the block
	const pointCell = ( e ) => {

		const r = box.getBoundingClientRect();
		const cw = r.width / layout.cols, ch = r.height / layout.rows;
		return { x: Math.floor( ( e.clientX - r.left ) / cw ), y: Math.floor( ( e.clientY - r.top ) / ch ), cw, ch };

	};

	const showGhost = ( p ) => {

		if ( ! drag ) return null;
		const me = layout.blocks.find( ( b ) => b.item.key === drag.key );
		const x = p.x - drag.dx, y = p.y - drag.dy;
		ghost.hidden = false;
		ghost.style.gridColumn = `${ Math.max( 1, x + 1 ) } / span ${ me.w }`;
		ghost.style.gridRow = `${ Math.max( 1, y + 1 ) } / span ${ me.h }`;
		const ok = canMoveTo( layout, drag.key, x, y );
		ghost.className = 'gm-ghost ' + ( ok ? 'is-ok' : 'is-bad' );
		return ok ? { x, y } : null;

	};

	for ( const b of layout.blocks ) {

		const it = b.item;
		const e = document.createElement( 'div' );
		e.className = `gm-block is-${ it.kind } ${ it.kind === 'fish' ? 'is-t' + it.tier : '' } ${ it.w * it.h === 1 ? 'is-1' : '' }`;
		e.draggable = true;
		e.title = it.title;
		e.dataset.key = it.key;
		e.style.gridColumn = `${ b.x + 1 } / span ${ b.w }`;
		e.style.gridRow = `${ b.y + 1 } / span ${ b.h }`;
		if ( it.color ) {

			e.style.setProperty( '--gm-crate', it.color );
			if ( it.cond != null && it.cond < 0.999 ) e.style.opacity = String( 0.55 + 0.45 * Math.max( 0, it.cond ) );

		}

		e.innerHTML = `<b>${ it.label }</b><i>${ it.sub }</i>`;
		e.addEventListener( 'dragstart', ( ev ) => {

			const r = e.getBoundingClientRect();
			const cw = r.width / b.w, ch = r.height / b.h;
			drag = { key: it.key, dx: Math.max( 0, Math.min( b.w - 1, Math.floor( ( ev.clientX - r.left ) / cw ) ) ), dy: Math.max( 0, Math.min( b.h - 1, Math.floor( ( ev.clientY - r.top ) / ch ) ) ) };
			e.classList.add( 'is-drag' );
			if ( ev.dataTransfer ) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData( 'text/plain', it.key ); } catch ( err ) { /* ignore */ } }
			if ( onDrag ) onDrag( true );

		} );
		e.addEventListener( 'dragend', () => {

			drag = null;
			e.classList.remove( 'is-drag' );
			ghost.hidden = true;
			if ( onDrag ) onDrag( false );

		} );
		box.appendChild( e );

	}

	box.addEventListener( 'dragover', ( ev ) => {

		if ( ! drag ) return;
		ev.preventDefault();
		if ( ev.dataTransfer ) ev.dataTransfer.dropEffect = 'move';
		showGhost( pointCell( ev ) );

	} );
	box.addEventListener( 'drop', ( ev ) => {

		if ( ! drag ) return;
		ev.preventDefault();
		const to = showGhost( pointCell( ev ) );
		const key = drag.key;
		drag = null;
		ghost.hidden = true;
		if ( onDrag ) onDrag( false );
		if ( to && onMove ) onMove( key, to.x, to.y );

	} );
	return layout;

}

export class GameHUD {

	constructor( ui, game ) {

		this.ui = ui;
		this.game = game;
		const style = h( 'style' );
		style.textContent = CSS;
		document.head.append( style );

		this.purse = h( 'div', 'gm-purse tw-glass', `<span class="gm-money">$0</span><span class="gm-cooler"><span class="gm-cooler-label">Cooler</span><span class="gm-cooler-bar"><span></span></span><span class="gm-cooler-kg">0 / 30 kg</span></span><span class="gm-gauge gm-fuel"><span data-l="fuel">Fuel</span><span class="gm-cooler-bar gm-fuel-bar"><span></span></span><b class="gm-fuel-l">40 L</b></span><span class="gm-gauge gm-sonar"><span data-l="sonar">Sonar</span><b class="gm-sonar-d">0 m</b><span class="gm-sonar-dots"></span></span><span class="gm-gauge gm-stam"><span data-l="stamina">Stamina</span><span class="gm-cooler-bar gm-stam-bar"><span></span></span></span>` );
		this.stamEl = this.purse.querySelector( '.gm-stam' );
		this.stamBar = this.purse.querySelector( '.gm-stam-bar > span' );
		this.fuelEl = this.purse.querySelector( '.gm-fuel' );
		this.fuelBar = this.purse.querySelector( '.gm-fuel-bar > span' );
		this.fuelL = this.purse.querySelector( '.gm-fuel-l' );
		this.sonarEl = this.purse.querySelector( '.gm-sonar' );
		this.sonarD = this.purse.querySelector( '.gm-sonar-d' );
		this.sonarDots = this.purse.querySelector( '.gm-sonar-dots' );
		this.moneyEl = this.purse.querySelector( '.gm-money' );
		this.coolerEl = this.purse.querySelector( '.gm-cooler' );
		this.coolerBar = this.purse.querySelector( '.gm-cooler-bar > span' );
		this.coolerKg = this.purse.querySelector( '.gm-cooler-kg' );
		this.coolerLabel = this.purse.querySelector( '.gm-cooler-label' );

		this.fight = h( 'div', 'gm-fight tw-glass', `
			<div class="gm-fight-head"><span class="gm-fight-call">Fish on!</span><span class="gm-fight-dist">0 m</span></div>
			<div class="gm-tension"><span class="gm-band"></span><span class="gm-danger"></span><span class="gm-needle"></span></div>
			<div class="gm-stamina"><span data-l="fish">Fish</span><span class="gm-stamina-bar"><span></span></span></div>` );
		this.fCall = this.fight.querySelector( '.gm-fight-call' );
		this.fDist = this.fight.querySelector( '.gm-fight-dist' );
		this.fBand = this.fight.querySelector( '.gm-band' );
		this.fNeedle = this.fight.querySelector( '.gm-needle' );
		this.fStam = this.fight.querySelector( '.gm-stamina-bar > span' );
		this.marker = new MarkerGauge( this.fight ); // the marker-timing fight's bar (the Unreal species)

		this.bite = h( 'div', 'gm-bite', '!' );
		this.cast = h( 'div', 'gm-cast', '<span></span>' );
		this.castBar = this.cast.firstChild;
		this.dot = h( 'div', 'gm-dot' );
		this.catchScrim = h( 'div', 'gm-catch-scrim' );
		this.catchCard = h( 'div', 'gm-catch tw-glass' );
		this.catchOpen = false;
		const hud = ui.hud || ui.root;
		hud.append( this.catchScrim, this.purse, this.fight, this.bite, this.cast, this.dot, this.catchCard );

		// panels (interactive)
		this.inv = h( 'div', 'gm-panel tw-glass tw-interactive' );
		this.stand = h( 'div', 'gm-panel tw-glass tw-interactive' );
		ui.root.append( this.inv, this.stand );
		this.invOpen = false;
		this.standOpen = false;
		this._last = {};
		this._labels();
		game.state.onChange( () => this.refresh() );
		this.refresh();

	}

	// the fixed labels of the purse and the fight panel, in the current language
	_labels() {

		const L = { fuel: t( 'hud.fuel', 'Fuel' ), sonar: t( 'hud.sonar', 'Sonar' ), stamina: t( 'hud.stamina', 'Stamina' ), fish: t( 'hud.fish', 'Fish' ) };
		for ( const el of [ ...this.purse.querySelectorAll( '[data-l]' ), ...this.fight.querySelectorAll( '[data-l]' ) ] ) el.textContent = L[ el.dataset.l ] ?? el.textContent;
		if ( this.fCall && ! this.fight.classList.contains( 'is-on' ) ) this.fCall.textContent = t( 'hud.fish_on', 'Fish on!' );

	}

	toast( text, ms ) {

		this.ui.toast( text, ms );

	}

	refresh() {

		const s = this.game.state;
		const st = s.stats;
		this.moneyEl.textContent = `$${ s.money.toLocaleString() }`;
		const kg = s.holdKg;
		this.coolerLabel.textContent = s.upgrades.hold > 0 ? t( 'hud.inv.hold', 'Fish hold' ) : t( 'touch.cooler', 'Cooler' );
		this.coolerKg.textContent = `${ kg.toFixed( 1 ) } / ${ st.holdKg } kg`;
		this.coolerBar.style.width = `${ Math.min( 100, kg / st.holdKg * 100 ) }%`;
		this.coolerEl.classList.toggle( 'is-full', kg > st.holdKg * 0.9 );
		if ( this._last.money !== undefined && this._last.money !== s.money ) {

			this.purse.classList.remove( 'is-bump' );
			void this.purse.offsetWidth;
			this.purse.classList.add( 'is-bump' );

		}

		this._last.money = s.money;
		if ( this.invOpen ) this.renderInventory();
		if ( this.standOpen ) this._keepScroll( () => ( this.vendor && this.vendor.kind === 'shop' ? this.renderShop() : this.renderStand() ) );

	}

	// per frame
	update( { fight, casting, power, bite, aiming, fuel = null, sonar = null, stamina = 1 } ) {

		this.stamEl.classList.toggle( 'is-on', stamina < 0.995 );
		this.stamBar.style.width = `${ stamina * 100 }%`;
		this.stamEl.classList.toggle( 'is-low', stamina < 0.2 );

		// boat instruments in the purse: fuel while aboard, the fish finder when fitted
		this.fuelEl.classList.toggle( 'is-on', !! fuel );
		if ( fuel ) {

			this.fuelBar.style.width = `${ fuel.litres / fuel.tank * 100 }%`;
			this.fuelL.textContent = `${ fuel.litres.toFixed( 0 ) } L`;
			this.fuelEl.classList.toggle( 'is-low', fuel.litres < fuel.tank * 0.15 );

		}

		this.sonarEl.classList.toggle( 'is-on', !! sonar );
		if ( sonar ) {

			this.sonarD.textContent = `${ sonar.depth.toFixed( 1 ) } m`;
			const n = Math.round( sonar.fish * 4 );
			this.sonarDots.textContent = '●'.repeat( n ) + '○'.repeat( 4 - n );

		}


		this.fight.classList.toggle( 'is-on', !! fight );
		this.marker.update( fight );
		if ( fight ) {

			const T = Math.min( fight.tension, 1.05 );
			this.fNeedle.style.left = `${ T / 1.05 * 100 }%`;
			this.fNeedle.classList.toggle( 'is-hot', fight.tension > fight.band[ 1 ] );
			this.fBand.style.left = `${ fight.band[ 0 ] / 1.05 * 100 }%`;
			this.fBand.style.width = `${ ( fight.band[ 1 ] - fight.band[ 0 ] ) / 1.05 * 100 }%`;
			this.fStam.style.width = `${ fight.stamina * 100 }%`;
			this.fDist.textContent = `${ fight.distance.toFixed( 1 ) } m`;
			let call = t( 'hud.call.reel', 'Reel in' ), cls = '';
			if ( fight.tension > 0.88 ) { call = t( 'hud.call.ease', 'Ease off!' ); cls = 'is-warn'; }
			else if ( fight.surge > 0.55 ) { call = t( 'hud.call.run', 'It\'s running!' ); cls = 'is-warn'; }
			else if ( ( fight.surgeWarn || 0 ) > 0.3 ) { call = t( 'hud.call.ready', 'Get ready, it\'s about to run' ); cls = 'is-warn'; }
			else if ( fight.hookHold !== undefined && fight.hookHold < 0.35 ) { call = t( 'hud.call.hook', 'The hook is tearing loose!' ); cls = 'is-warn'; }
			else if ( fight.tension < 0.15 ) { call = t( 'hud.call.slack', 'Slack line!' ); cls = 'is-warn'; }
			else if ( fight.tension >= fight.band[ 0 ] && fight.tension <= fight.band[ 1 ] ) { call = t( 'hud.call.good', 'Good pressure' ); cls = 'is-good'; }
			if ( fight.call ) ( { text: call, cls } = fight.call ); // the marker fight words its own calls
			if ( call !== this._call ) { this._call = call; this.fCall.textContent = call; }
			this.fCall.className = 'gm-fight-call ' + cls;

		}

		this.bite.classList.toggle( 'is-on', !! bite );
		this.cast.classList.toggle( 'is-on', !! casting );
		if ( casting ) this.castBar.style.width = `${ power * 100 }%`;
		this.dot.classList.toggle( 'is-on', !! aiming && ! this.invOpen && ! this.standOpen && ! this.rosterOpen );

	}

	// ---- catch card
	// info: GameState.lastCatch ({ species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept })
	showCatch( info, ms = 9000 ) {

		const f = FISH[ info.species ];
		const inch = info.cm / 2.54, lb = info.kg * 2.20462;
		const badge = info.record ? `<span class="gm-badge is-record">★ ${ t( 'hud.catch.record', 'New record' ) }</span>`
			: info.newSpecies ? `<span class="gm-badge is-new">${ t( 'hud.catch.new', 'New species' ) }</span>` : `<span class="gm-badge is-plain">${ t( 'hud.catch.catch', 'Catch' ) }</span>`;
		let note;
		if ( ! info.kept ) note = `<div class="gm-catch-note is-warn">${ t( 'hud.catch.noroom', 'No room in the {where} · you let it go', { where: this.game.state.upgrades.hold > 0 ? t( 'hud.hold_lc', 'hold' ) : t( 'hud.cooler_lc', 'cooler' ) } ) }</div>`;
		else if ( info.record ) note = `<div class="gm-catch-note">${ t( 'hud.catch.prev', 'Previous best {kg} kg · {cm} cm. Beaten by {by} kg.', { kg: info.prevBestKg.toFixed( 2 ), cm: info.prevBestCm, by: ( info.kg - info.prevBestKg ).toFixed( 2 ) } ) }</div>`;
		else if ( info.newSpecies ) note = `<div class="gm-catch-note">${ t( 'hud.catch.first', 'First one in your fish log.' ) }</div>`;
		else note = `<div class="gm-catch-note">${ t( 'hud.catch.best', 'Your best: {kg} kg · {cm} cm', { kg: info.prevBestKg.toFixed( 2 ), cm: info.prevBestCm } ) }</div>`;
		// a tap on touch; the click or the interact key elsewhere
		const goOn = touchOn( this ) ? t( 'hud.catch.tap', 'Tap to continue' )
			: t( 'hud.catch.continue', '{click} or {key} to continue', { click: `<kbd>${ t( 'hud.catch.click', 'Click' ) }</kbd>`, key: `<kbd>${ keyHint( this, 'E' ) }</kbd>` } );
		// splash burst around the fish as it lands in view
		let drops = '';
		for ( let i = 0; i < 26; i ++ ) {

			const a = ( i / 26 ) * Math.PI * 2 + Math.random() * 0.3, r = 90 + Math.random() * 260;
			drops += `<i style="--s:${ ( 4 + Math.random() * 12 ).toFixed( 1 ) }px;--x:${ ( Math.cos( a ) * r * 1.8 ).toFixed( 0 ) }px;--y:${ ( Math.sin( a ) * r * 0.55 - 40 ).toFixed( 0 ) }px;--d:${ ( 250 + Math.random() * 220 ).toFixed( 0 ) }ms"></i>`;

		}

		const c = this.catchCard;
		c.style.setProperty( '--gm-catch-ms', `${ ms }ms` );
		c.innerHTML = `
			<div class="gm-catch-top">
				<div class="gm-catch-eyebrow">${ badge }</div>
				<h2>${ f.name }</h2>
				<div class="gm-catch-sci">${ f.sci || '' }</div>
			</div>
			<div class="gm-catch-stage"><canvas></canvas><div class="gm-splash">${ drops }</div></div>
			<div class="gm-catch-bottom">
				<div class="gm-catch-stats">
					<div class="gm-stat"><span>${ t( 'hud.catch.length', 'Length' ) }</span><b>${ info.cm }<small>cm</small></b><i>${ inch.toFixed( 1 ) } in</i></div>
					<div class="gm-stat"><span>${ t( 'hud.st.weight', 'Weight' ) }</span><b>${ info.kg < 1 ? info.kg.toFixed( 2 ) : info.kg.toFixed( 1 ) }<small>kg</small></b><i>${ lb.toFixed( 1 ) } lb</i></div>
					<div class="gm-stat is-value"><span>${ t( 'hud.catch.value', 'Value' ) }</span><b>$${ info.value }</b><i>${ info.kept ? t( 'hud.catch.kept', 'in the cooler' ) : t( 'hud.catch.let_go', 'let go' ) }</i></div>
				</div>
				${ note }
				<div class="gm-catch-foot">${ goOn }<span class="gm-catch-timer"><span></span></span></div>
			</div>`;
		// restart the entrance even when a card is already up
		c.classList.remove( 'is-on' );
		void c.offsetWidth;
		c.classList.add( 'is-on' );
		this.catchScrim.classList.add( 'is-on' );
		this.catchOpen = true;
		// the fish itself: the real model in a studio, drawn live into the stage canvas
		try {

			if ( ! this.portrait ) this.portrait = new FishPortrait();
			if ( this.portrait.attach( c.querySelector( '.gm-catch-stage canvas' ) ) ) this.portrait.show( info.species, info.kg );

		} catch ( e ) {

			console.warn( 'fish portrait unavailable', e );

		}

	}

	hideCatch() {

		this.catchCard.classList.remove( 'is-on' );
		this.catchScrim.classList.remove( 'is-on' );
		this.catchOpen = false;
		if ( this.portrait ) this.portrait.detach();

	}

	// ---- inventory
	toggleInventory( force ) {

		this.invOpen = force ?? ! this.invOpen;
		if ( this.invOpen ) {

			this.closeStand();
			this.renderInventory();
			releaseMouse();

		}

		this.inv.classList.toggle( 'is-open', this.invOpen );

	}

	// the cooler as a list or as the hold grid (the choice is remembered)
	get invView() {

		if ( this._invView ) return this._invView;
		let v = 'hold';
		try {

			if ( localStorage.getItem( VIEW_KEY ) === 'list' ) v = 'list';

		} catch ( e ) { /* no storage */ }

		return ( this._invView = v );

	}

	setInvView( v ) {

		this._invView = v === 'list' ? 'list' : 'hold';
		try {

			localStorage.setItem( VIEW_KEY, this._invView );

		} catch ( e ) { /* no storage */ }

		this.renderInventory();

	}

	renderInventory() {

		if ( this._holdDrag ) return; // a block is in the air: do not rebuild the panel under the mouse
		const s = this.game.state;
		const view = this.invView;
		const rows = s.inventory.map( ( f ) => `<div class="gm-row has-cm"><span>${ FISH[ f.species ].name }${ f.record ? `<small>${ t( 'hud.inv.record', 'record' ) }</small>` : '' }</span><span class="gm-cm">${ f.cm ?? Math.round( fishLengthCm( f.species, f.kg ) ) } cm</span><span class="gm-kg">${ f.kg.toFixed( 2 ) } kg</span><span class="gm-val">$${ f.value }</span><button class="gm-mini" data-release="${ f.id }">${ t( 'hud.inv.release', 'Release' ) }</button></div>` ).join( '' );
		const logged = Object.entries( s.log ).filter( ( [ k ] ) => FISH[ k ] ).map( ( [ k, v ] ) => t( 'hud.inv.log_row', '{name}: {n} caught, best {kg} kg · {cm} cm', { name: FISH[ k ].name, n: v.count, kg: v.bestKg.toFixed( 2 ), cm: v.bestCm ?? Math.round( fishLengthCm( k, v.bestKg ) ) } ) ).join( '<br>' );
		const body = view === 'hold'
			? '<div class="gm-hold-wrap"><div class="gm-hold" data-hold></div></div><div class="gm-hold-key" data-hold-key></div>'
			: `<div class="gm-list">${ rows || `<div class="gm-empty">${ t( 'hud.inv.empty', 'Nothing yet. Cast from the pier, the beach or the boat.' ) }</div>` }</div>`;
		this.inv.innerHTML = `
			<h2>${ s.upgrades.hold > 0 ? t( 'hud.inv.hold', 'Fish hold' ) : t( 'touch.cooler', 'Cooler' ) }</h2>
			<p class="gm-sub">${ t( 'hud.inv.sub', '{n} fish · {kg} of {max} kg · worth ${v}', { n: s.inventory.length, kg: s.holdKg.toFixed( 1 ), max: s.stats.holdKg, v: s.holdValue } ) }</p>
			<div class="gm-tabs" role="tablist"><button class="gm-tab ${ view === 'hold' ? 'is-on' : '' }" data-view="hold" role="tab">${ t( 'hud.inv.grid', 'Grid' ) }</button><button class="gm-tab ${ view === 'list' ? 'is-on' : '' }" data-view="list" role="tab">${ t( 'hud.inv.list', 'List' ) }</button></div>
			${ body }
			${ logged ? `<div class="gm-log"><b>${ t( 'hud.inv.log', 'Fish log' ) }</b><br>${ logged }</div>` : '' }
			${ this.renderStats ? this.renderStats() : '' }
			<div class="gm-foot"><span class="gm-sub">${ t( 'hud.inv.foot', 'Sell at the fish stand by the pier' ) }</span><button class="gm-btn is-ghost" data-close>${ closeLabel( this, 'I' ) }</button></div>`;
		this.inv.querySelector( '[data-close]' ).onclick = () => this.toggleInventory( false );
		for ( const b of this.inv.querySelectorAll( '[data-view]' ) ) b.onclick = () => this.setInvView( b.dataset.view );
		for ( const b of this.inv.querySelectorAll( '[data-release]' ) ) b.onclick = () => s.release( Number( b.dataset.release ) );
		if ( view === 'hold' ) this.renderHold( this.inv.querySelector( '[data-hold]' ), this.inv.querySelector( '[data-hold-key]' ) );

	}

	// the hold grid: fish blocks and trade crates, placed where the player dragged them
	renderHold( box, keyEl ) {

		if ( ! box ) return;
		const s = this.game.state;
		const trade = this.game.app && this.game.app.features && this.game.app.features.get ? this.game.app.features.get( 'trade' ) : null;
		const items = holdItems( s, trade );
		const total = holdCells( s.stats.holdKg, trade ? trade.capacity() : 0 );
		const storage = typeof localStorage !== 'undefined' ? localStorage : null;
		const slotKey = `${ s.mode || 'campaign' }.${ s.slot | 0 }`;
		const pos = storage ? loadHoldPos( storage, slotKey ) : {};
		const layout = layoutHold( items, { cols: HOLD_COLS, cells: total, pos } );
		// forget the places of fish that left the hold
		if ( storage && Object.keys( pos ).some( ( k ) => ! layout.blocks.some( ( b ) => b.item.key === k ) ) ) saveHoldPos( storage, slotKey, layout );
		buildHoldGrid( box, layout, {
			total,
			onDrag: ( on ) => { this._holdDrag = on; },
			onMove: ( key, x, y ) => {

				const b = layout.blocks.find( ( q ) => q.item.key === key );
				if ( ! b ) return;
				b.x = x;
				b.y = y;
				if ( storage ) saveHoldPos( storage, slotKey, layout );
				this.renderInventory();

			},
		} );
		if ( keyEl ) {

			const used = layout.blocks.reduce( ( n, b ) => n + b.w * b.h, 0 );
			const crates = items.filter( ( i ) => i.kind === 'crate' ).length;
			keyEl.innerHTML = `<span style="--k:#8fa9b8">${ t( 'hud.inv.cheap', 'cheap' ) }</span><span style="--k:#7fd08a">${ t( 'hud.inv.fair', 'fair' ) }</span><span style="--k:#f0c46a">${ t( 'hud.inv.good', 'good' ) }</span><span style="--k:#ff8f7a">${ t( 'hud.inv.prize', 'prize' ) }</span><span style="--k:#c9a86a">${ t( 'hud.inv.crates', 'trade crates: {n}', { n: crates } ) }</span><span>${ layout.over ? t( 'hud.inv.cells_over', '{used} of {total} cells, overflow row', { used, total } ) : t( 'hud.inv.cells', '{used} of {total} cells', { used, total } ) }</span>`;

		}

	}

	// ---- fish stand
	openStand( vendor ) {

		this.standOpen = true;
		this.vendor = vendor;
		this.toggleInventory( false );
		if ( vendor.kind === 'shop' ) this._keepScroll( () => this.renderShop() );
		else this._keepScroll( () => this.renderStand() );
		this.stand.classList.add( 'is-open' );
		releaseMouse();

	}

	closeStand() {

		this.standOpen = false;
		this.stand.classList.remove( 'is-open' );

	}

	// a re-render (a purchase, a sale) replaces the list: keep it scrolled where it was
	_keepScroll( render ) {

		const list = this.stand.querySelector( '.gm-list' );
		const top = list ? list.scrollTop : 0, panelTop = this.stand.scrollTop;
		render();
		const after = this.stand.querySelector( '.gm-list' );
		if ( after && top ) after.scrollTop = top;
		if ( panelTop ) this.stand.scrollTop = panelTop;

	}

	renderStand() {

		const s = this.game.state;
		const v = this.vendor || { name: 'Fish buyer' };
		const rows = s.inventory.map( ( f ) => `<div class="gm-row has-cm"><span>${ FISH[ f.species ].name }</span><span class="gm-cm">${ f.cm ?? Math.round( fishLengthCm( f.species, f.kg ) ) } cm</span><span class="gm-kg">${ f.kg.toFixed( 2 ) } kg</span><span class="gm-val">$${ f.value }</span><button class="gm-mini" data-sell="${ f.id }">Sell</button></div>` ).join( '' );
		this.stand.innerHTML = `
			<h2>${ v.name }</h2>
			<p class="gm-sub">${ s.inventory.length ? v.greeting || 'Let\'s see what you caught.' : v.idle || 'Come back when you\'ve got fish.' }</p>
			<div class="gm-list">${ rows || '<div class="gm-empty">Your cooler is empty.</div>' }</div>
			<div class="gm-foot"><button class="gm-btn is-ghost" data-close>${ leaveLabel( this ) }</button><button class="gm-btn" data-all ${ s.inventory.length ? '' : 'disabled' }>Sell all · $${ s.holdValue }</button></div>`;
		this.stand.querySelector( '[data-close]' ).onclick = () => this.closeStand();
		this.stand.querySelector( '[data-all]' ).onclick = () => this.game.sellAll();
		for ( const b of this.stand.querySelectorAll( '[data-sell]' ) ) b.onclick = () => this.game.sell( [ Number( b.dataset.sell ) ] );

	}

}

GameHUD.prototype.renderShop = function () {

	const s = this.game.state;
	const v = this.vendor;
	const rows = Object.entries( UPGRADES ).map( ( [ key, track ] ) => {

		const cur = track.levels[ s.upgrades[ key ] | 0 ];
		const next = nextLevel( s.upgrades, key );
		const gate = gearGate( s, key, this.game.app?.features?.get( 'trade' )?.credit?.standing ?? null );
		const btn = next
			? `<button class="gm-btn" data-buy="${ key }" ${ next.cost > s.money || ! gate.ok ? 'disabled' : '' }>$${ next.cost }</button>`
			: '<span class="gm-have">Top of the line</span>';
		const needs = next && gate.why === 'locked' ? ` · Needs: ${ gate.reasons.join( ', ' ) }` : '';
		return `<div class="gm-shop-row"><span>${ track.name }: ${ next ? next.label : cur.label }<small>Now: ${ cur.label }${ needs }</small></span>${ btn }</div>`;

	} ).join( '' );
	const missing = s.stats.fuelL - s.fuelL;
	const fuelRow = `<div class="gm-shop-row"><span>Diesel · $${ FUEL_PRICE.toFixed( 2 ) } / L<small>Tank: ${ s.fuelL.toFixed( 0 ) } of ${ s.stats.fuelL } L</small></span>${ missing > 0.5 ? `<button class="gm-btn" data-fuel ${ s.money < FUEL_PRICE ? 'disabled' : '' }>Fill · $${ s.refuelCost() }</button>` : '<span class="gm-have">Full</span>' }</div>`;
	this.stand.innerHTML = `
		<h2>${ v.name }</h2>
		<p class="gm-sub">${ v.greeting } · You have $${ s.money.toLocaleString() }</p>
		<div class="gm-list">${ fuelRow }${ rows }</div>
		<div class="gm-foot"><span class="gm-sub">Upgrades take effect at once</span><button class="gm-btn is-ghost" data-close>${ leaveLabel( this ) }</button></div>`;
	this.stand.querySelector( '[data-close]' ).onclick = () => this.closeStand();
	for ( const b of this.stand.querySelectorAll( '[data-buy]' ) ) b.onclick = () => this.game.buy( b.dataset.buy );
	const f = this.stand.querySelector( '[data-fuel]' );
	if ( f ) f.onclick = () => this.game.refuel();

};

installHudPanels( GameHUD );

// the key the player has bound for a default key letter (Accessibility.keyHint), else the letter
function keyHint( hud, k ) {

	try {

		const a = hud.game && hud.game.app && hud.game.app.accessibility;
		return a && typeof a.keyHint === 'function' ? a.keyHint( k ) : k;

	} catch ( e ) {

		return k;

	}

}

export function releaseMouse() {

	try {

		if ( document.pointerLockElement && document.exitPointerLock ) document.exitPointerLock();

	} catch ( e ) { /* ignore */ }

}
