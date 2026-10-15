// Naval HUD: a hull bar and the two reload indicators while at the helm, offscreen arrows for pirates within
// 400 m, a hit marker when the player's ball lands and a red wedge toward whoever hit the player.
// Class prefix `nv-`; the stylesheet is injected once. Colours come from the game's tokens (--tw-*) with fallbacks.
//
//   const hud = new NavalHud( { doc: document } );   // doc optional: without a DOM nothing is built (node)
//   hud.update( model, dt )                           // model from hudModel( naval ) every frame
//   hud.hitMarker( 'hit' | 'sunk' );  hud.damageFrom( angle )   angle: radians clockwise from screen-up
//   hud.dispose()
//
// Pure helpers (tested in node): arrowFor( camera, point ) and hudModel( naval ).
//
// Wave 4: the battery rows say plainly what each side can do - READY or the seconds left, the gun count, and the range to
// the target the side would fire at ("142 m", "no target") - and the aim assist (AimAssist.js) draws each loaded side's
// arc, the lead marker, and the hit / short / long / wide line after a broadside. model.aim carries the two aim plans.
//
// Wave 9: while aiming by hand (right mouse, naval.aiming) a centre crosshair with a ranging readout ("PORT · 214 m",
// "out of arc", the reload); the target's hull bar (the pirate last hit, else the nearest within gun range) with a mark at
// the cripple line (25 %: below it she strikes and can be boarded); and, for a few seconds after trying to fire or aim
// without a gun, "No gun - Captain Roid sells a swivel gun" (model.noGun).
//
// Wave 10: in the third-person aim rig (naval.aimCamera) the crosshair sits on the projected impact of the aimed arc
// (model.aiming.screen from arrowFor, the readout beside it) and dims "out of arc" past the swing; first person keeps the
// centred crosshair. The gun rows' reload bars run over naval.reloadTotal (a crew gunner's reload is longer).

//
// Wave 11A: the powder and shot aboard ("Shot 12 / 16", "Out of shot" in red after a dry click: model.ammo, model.outOfShot),
// a damage-control line for her own hull ("FIRE 45 %", "Flooding 30 %", a shot-up rudder / sails / mast: model.dc), the gun rows
// say "NO SHOT" / "OUT OF ACTION", the target bar carries the pirate's sections as small pips (model.target.sections: rudder,
// sails, mast, guns; red when shot away) with a flame when she burns, and the aiming readout names the aimed part (Tab).

import { rotateByQuat } from './Ballistics.js';
import { AIM_LABELS } from './Sections.js';
import { OUT_OF_SHOT } from './Ammo.js';
import { AimAssist, aimPlan, AIM_CSS } from './AimAssist.js';
import { setText, setStyle, setNum } from './DomWrites.js';

export const ARROW_RANGE = 400;
export const TARGET_RANGE = 320; // m (x the long-gun module's range): the target bar shows a pirate this close
export const NO_GUN_TEXT = 'No gun - Captain Roid sells a swivel gun';
const EDGE = 0.07; // screen fraction kept free around the arrows

// Where a world point is on screen. camera: { position, quaternion, fov (deg), aspect }.
// Returns { visible: bool (on screen), x, y (0..1, clamped to the edge when off screen), angle (rad clockwise from up), behind }
export function arrowFor( camera, p, out = {} ) {

	const q = camera.quaternion;
	const rel = rotateByQuat( { x: - q.x, y: - q.y, z: - q.z, w: q.w }, { x: p.x - camera.position.x, y: p.y - camera.position.y, z: p.z - camera.position.z } );
	const t = Math.tan( ( camera.fov || 60 ) * Math.PI / 360 );
	const aspect = camera.aspect || 16 / 9;
	const front = rel.z < - 0.01;
	if ( front ) {

		const nx = rel.x / ( - rel.z * t * aspect ), ny = rel.y / ( - rel.z * t );
		if ( Math.abs( nx ) < 0.94 && Math.abs( ny ) < 0.94 ) {

			out.visible = true;
			out.behind = false;
			out.x = 0.5 + nx * 0.5;
			out.y = 0.5 - ny * 0.5;
			out.angle = 0;
			return out;

		}

	}

	// off screen: along the direction of the point on the screen plane
	let dx = rel.x, dy = rel.y;
	if ( Math.hypot( dx, dy ) < 1e-4 ) { dx = 0; dy = - 1; }
	const l = Math.hypot( dx, dy );
	dx /= l; dy /= l;
	const half = 0.5 - EDGE;
	const k = Math.min( Math.abs( dx ) > 1e-6 ? half / Math.abs( dx ) : Infinity, Math.abs( dy ) > 1e-6 ? half / Math.abs( dy ) : Infinity );
	out.visible = false;
	out.behind = ! front;
	out.x = 0.5 + dx * k;
	out.y = 0.5 - dy * k;
	out.angle = Math.atan2( dx, dy );
	return out;

}

// The hull bar of the pirate in front of the guns: the one the player last hit (naval.hudTarget) while within gun range,
// else the nearest within it. { id, name, frac, mark (the cripple line), crippled, dist } | null
export function targetBar( naval ) {

	const b = naval.app && naval.app.boatCtl;
	if ( ! b || ! b.position || ! naval.ships ) return null;
	const reach = TARGET_RANGE * ( naval.mods && Number.isFinite( naval.mods.range ) ? naval.mods.range : 1 );
	const mark = Number.isFinite( naval.crippleAt ) ? naval.crippleAt : 0.25;
	let best = null, bd = Infinity;
	for ( const s of naval.ships ) {

		if ( s.faction !== 'pirate' || ! s.alive ) continue;
		const d = Math.hypot( s.x - b.position.x, s.z - b.position.z );
		if ( d > reach ) continue;
		const score = s.id === naval.hudTarget ? - 1 : d;
		if ( score < bd ) { bd = score; best = s; }

	}

	if ( ! best ) return null;
	const frac = Math.max( 0, Math.min( 1, best.hp / best.maxHp ) );
	return {
		id: best.id, name: best.bounty ? best.captain : best.name, frac, mark, crippled: frac < mark,
		dist: Math.round( Math.hypot( best.x - b.position.x, best.z - b.position.z ) ),
		sections: best.sections ? best.sections.pips() : [], fire: best.fire ? best.fire.level : 0, flood: best.flood ? best.flood.level : 0,
	};

}

// her own hull's trouble in a few words: 'FIRE 45 % · Flooding 30 % · Rudder 20 % · Mast down' | null
export function damageLine( naval ) {

	const out = [];
	const f = naval.fireState, w = naval.floodState, sec = naval.sections;
	if ( f && f.burning ) out.push( `FIRE ${ Math.round( f.level * 100 ) } %` );
	if ( w && w.level > 0.005 ) out.push( `Flooding ${ Math.round( w.level * 100 ) } %` );
	if ( sec ) {

		if ( sec.mastDown ) out.push( 'Mast down' );
		for ( const id of [ 'rudder', 'sails', 'engine' ] ) {

			if ( ! sec.has( id ) || ( id === 'sails' && sec.mastDown ) ) continue;
			const fr = sec.frac( id );
			if ( fr < 0.5 ) out.push( `${ id[ 0 ].toUpperCase() + id.slice( 1 ) } ${ Math.round( fr * 100 ) } %` );

		}

	}

	return out.length ? { text: out.join( ' · ' ), urgent: !! ( f && f.burning ) || !! ( w && w.level > 0.4 ) } : null;

}

// What the HUD shows this frame, from the naval instance.
export function hudModel( naval ) {

	const app = naval.app || {};
	const h = naval.playerHull;
	const atHelm = !! ( app.player && app.player.mode === 'boat' );
	const visible = atHelm && naval.active !== false;
	// the aim plans (one per side) while at the helm with guns: the same target pick and lead as Naval.fire
	let aim = null;
	if ( visible && naval.playerGun.owned && ! h.sunk ) {

		try { aim = [ aimPlan( naval, 'port' ), aimPlan( naval, 'starboard' ) ]; } catch ( e ) { aim = null; }

	}

	const guns = [ 'port', 'starboard' ].map( ( side, i ) => {

		const total = ( naval.reloadTotal && naval.reloadTotal[ side ] > 0 ? naval.reloadTotal[ side ] : 0 ) || naval.reloadTime( naval.playerGun.level );
		const left = naval.reloadLeft[ side ];
		const p = aim && aim[ i ];
		const dry = !! naval.ammo && naval.ammo.max > 0 && naval.ammo.rounds <= 0;
		const silent = !! naval.sections && ! naval.sections.gunsOk( side );
		return {
			side, key: side === 'port' ? 'Z' : 'X', owned: naval.playerGun.owned, count: Math.max( 1, naval.playerGun.guns | 0 ), ready: left <= 0 && ! dry && ! silent, frac: left <= 0 ? 1 : Math.max( 0, 1 - left / total ),
			left: Math.max( 0, left ), range: p && p.inArc ? p.range : null, target: p && p.inArc && p.target ? p.target.name : null, dry, silent,
		};

	} );
	const ai = naval.aiming ? naval.aimInfo : null;
	let aiming = null;
	if ( ai ) {

		// third person: the crosshair on the projected impact of the aimed arc (the dots end there)
		const third = typeof naval._thirdPerson === 'function' && naval._thirdPerson();
		const plan = aim ? aim.find( ( p ) => p && p.aimed && p.side === ai.side ) : null;
		const point = plan && plan.impact ? plan.impact : ai.point;
		const cam = app.camera;
		aiming = {
			side: ai.side, range: Math.round( ai.range ), inArc: !! ai.inArc, ready: ( naval.reloadLeft[ ai.side ] || 0 ) <= 0, left: Math.max( 0, naval.reloadLeft[ ai.side ] || 0 ),
			part: naval.aimPart || 'hull',
			third, point: point || null, screen: third && point && cam && cam.position && cam.quaternion ? arrowFor( cam, point ) : null,
		};

	}

	const model = {
		visible,
		hull: { hp: Math.ceil( h.hp ), max: h.max, frac: h.max > 0 ? h.hp / h.max : 0, low: h.hp / h.max < 0.34, sunk: h.sunk },
		guns,
		arrows: [],
		aim,
		aiming,
		target: visible ? targetBar( naval ) : null,
		noGun: visible && Number.isFinite( naval._noGunUntil ) && naval._noGunUntil > ( naval.time || 0 ),
		ammo: naval.ammo && naval.playerGun.owned && naval.ammo.max > 0 ? { rounds: naval.ammo.rounds, max: naval.ammo.max, out: naval.ammo.rounds <= 0 } : null,
		outOfShot: visible && Number.isFinite( naval._outOfShotUntil ) && naval._outOfShotUntil > ( naval.time || 0 ),
		dc: damageLine( naval ),
		camera: app.camera || null,
		features: naval.features || null,
	};
	const cam = app.camera;
	if ( model.visible && cam && cam.position ) {

		const pos = app.boatCtl && app.boatCtl.position ? app.boatCtl.position : cam.position;
		const reach = typeof naval.sightRange === 'function' ? naval.sightRange() : ARROW_RANGE; // the spyglass module
		for ( const s of naval.ships ) {

			if ( s.faction !== 'pirate' || ! s.alive ) continue;
			const d = Math.hypot( s.x - pos.x, s.z - pos.z );
			if ( d > reach ) continue;
			const a = arrowFor( cam, { x: s.x, y: s.pose.y + 3, z: s.z } );
			if ( a.visible ) continue;
			model.arrows.push( { id: s.id, name: s.bounty ? s.captain : s.cls.label, dist: Math.round( d ), x: a.x, y: a.y, angle: a.angle, hunting: s.state === 'chase' || s.state === 'broadside' } );

		}

	}

	return model;

}

const CSS = `
.nv-root { position: fixed; left: var(--nv-left, 18px); bottom: var(--nv-bottom, 96px); z-index: 20; display: none; flex-direction: column; gap: 6px; min-width: 190px; pointer-events: none; font: 500 12px var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #e9eef2); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.nv-root.is-on { display: flex; }
.nv-hull { display: flex; align-items: center; gap: 8px; }
.nv-label { letter-spacing: 0.08em; text-transform: uppercase; font-size: 11px; color: var(--tw-ink-3, #9fb0bd); min-width: 34px; }
.nv-bar { flex: 1; height: 7px; border-radius: 99px; background: var(--tw-fill-2, rgba(255, 255, 255, 0.16)); overflow: hidden; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35); }
.nv-bar > span { display: block; height: 100%; width: 100%; background: #6fb878; transform-origin: left; transition: background 0.2s; }
.nv-hull.is-low .nv-bar > span { background: #d9553f; }
.nv-num { font: 500 12px var(--tw-mono, ui-monospace, monospace); min-width: 30px; text-align: right; }
.nv-guns { display: flex; gap: 10px; }
.nv-gun { flex: 1; display: flex; align-items: center; gap: 6px; opacity: 0.85; }
.nv-gun.is-off { display: none; }
.nv-gun kbd { font: 600 11px var(--tw-mono, ui-monospace, monospace); padding: 1px 5px; border-radius: 4px; background: rgba(0, 0, 0, 0.45); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28); }
.nv-gun i { flex: 1; height: 5px; border-radius: 99px; background: var(--tw-fill-2, rgba(255, 255, 255, 0.16)); overflow: hidden; }
.nv-gun i > b { display: block; height: 100%; width: 0; background: var(--tw-sun, #f0b44a); }
.nv-gun.is-ready i > b { background: #8fd18c; }
.nv-gun em { font: 600 10.5px var(--tw-mono, ui-monospace, monospace); font-style: normal; min-width: 64px; text-align: right; color: var(--tw-ink-3, #9fb0bd); white-space: nowrap; }
.nv-gun.is-ready em { color: #b8e6b4; }
.nv-gun.is-target em { color: #ffe08a; }
.nv-guns { flex-direction: column; gap: 4px; }
.nv-arrows { position: fixed; inset: 0; z-index: 19; pointer-events: none; }
.nv-arrow { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 2px; font: 600 11px var(--tw-font, system-ui, sans-serif); color: #ffd9d2; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); }
.nv-arrow i { width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 18px solid #e0573f; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7)); }
.nv-arrow.is-hunting i { border-bottom-color: #ff3b2a; }
.nv-hit { position: fixed; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; z-index: 21; pointer-events: none; opacity: 0; }
.nv-hit::before, .nv-hit::after { content: ''; position: absolute; left: 50%; top: 0; width: 3px; height: 100%; margin-left: -1.5px; background: #fff; transform: rotate(45deg); border-radius: 2px; }
.nv-hit::after { transform: rotate(-45deg); }
.nv-hit.is-sunk::before, .nv-hit.is-sunk::after { background: #ffd24a; }
.nv-dmg { position: fixed; inset: 0; z-index: 21; pointer-events: none; opacity: 0; }
.nv-dmg > b { position: absolute; left: 50%; top: 5%; width: 38vmin; height: 12px; margin-left: -19vmin; border-radius: 99px; background: radial-gradient(closest-side, rgba(224, 40, 28, 0.95), rgba(224, 40, 28, 0)); transform-origin: 50% 45vh; }
.nv-tgt { display: none; align-items: center; gap: 8px; }
.nv-tgt.is-on { display: flex; }
.nv-tgt .nv-label { color: #ffb4a6; max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0.02em; }
.nv-tgt .nv-bar { position: relative; overflow: visible; }
.nv-tgt .nv-bar > span { background: #d9553f; border-radius: 99px; }
.nv-tgt.is-crippled .nv-bar > span { background: #f0b44a; }
.nv-tgt .nv-bar > i { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 2px rgba(0, 0, 0, 0.8); }
.nv-nogun { display: none; color: #ffd9a8; font-weight: 600; }
.nv-nogun.is-on { display: block; }
.nv-xhair { position: fixed; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px; z-index: 21; pointer-events: none; display: none; border: 2px solid rgba(255, 255, 255, 0.85); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4); }
.nv-xhair::before, .nv-xhair::after { content: ''; position: absolute; left: 50%; top: 50%; background: rgba(255, 255, 255, 0.9); }
.nv-xhair::before { width: 2px; height: 8px; margin: -4px 0 0 -1px; }
.nv-xhair::after { width: 8px; height: 2px; margin: -1px 0 0 -4px; }
.nv-xhair.is-on { display: block; }
.nv-xhair.is-out { border-color: rgba(255, 150, 120, 0.8); opacity: 0.45; }
.nv-xread { position: fixed; left: 50%; top: calc(50% + 22px); transform: translateX(-50%); z-index: 21; pointer-events: none; display: none; font: 600 12px var(--tw-mono, ui-monospace, monospace); color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85); white-space: nowrap; }
.nv-xread.is-on { display: block; }
.nv-ammo { font: 600 11px var(--tw-mono, ui-monospace, monospace); color: var(--tw-ink-3, #9fb0bd); }
.nv-ammo.is-low { color: #ffd9a8; }
.nv-ammo.is-out { color: #ff8a73; }
.nv-dc { display: none; font: 600 11px var(--tw-mono, ui-monospace, monospace); color: #ffd9a8; }
.nv-dc.is-on { display: block; }
.nv-dc.is-urgent { color: #ff8a73; }
.nv-pips { display: flex; gap: 3px; margin-left: 4px; }
.nv-pips > i { width: 6px; height: 6px; border-radius: 2px; background: #8fd18c; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45); }
.nv-pips > i.is-hurt { background: #f0b44a; }
.nv-pips > i.is-gone { background: #d9553f; }
.nv-pips > i.is-fire { background: #ff7a2a; border-radius: 50%; }
@media (prefers-reduced-motion: reduce) { .nv-bar > span { transition: none; } }
${ AIM_CSS }`;

let cssDone = false;

export class NavalHud {

	constructor( { doc = typeof document !== 'undefined' ? document : null } = {} ) {

		this.doc = doc;
		this.arrows = new Map();
		this.hitT = 0;
		this.dmgT = 0;
		this.dmgAngle = 0;
		this.root = null;
		if ( ! doc ) return;
		if ( ! cssDone ) {

			const style = doc.createElement( 'style' );
			style.id = 'nv-style';
			style.textContent = CSS;
			( doc.head || doc.body ).append( style );
			cssDone = true;

		}

		const make = ( tag, cls, parent, text ) => {

			const e = doc.createElement( tag );
			if ( cls ) e.className = cls;
			if ( text !== undefined ) e.textContent = text;
			if ( parent ) parent.append( e );
			return e;

		};

		this._make = make;
		this.root = make( 'div', 'nv-root' );
		this.hullRow = make( 'div', 'nv-hull', this.root );
		make( 'span', 'nv-label', this.hullRow, 'Hull' );
		const bar = make( 'span', 'nv-bar', this.hullRow );
		this.hullFill = make( 'span', '', bar );
		this.hullNum = make( 'b', 'nv-num', this.hullRow, '' );
		this.gunRow = make( 'div', 'nv-guns', this.root );
		this.gunEls = {};
		for ( const [ side, key, label ] of [ [ 'port', 'Z', 'Port' ], [ 'starboard', 'X', 'Stbd' ] ] ) {

			const g = make( 'div', 'nv-gun', this.gunRow );
			make( 'kbd', '', g, key );
			const name = make( 'span', '', g, label );
			const i = make( 'i', '', g );
			const fill = make( 'b', '', i );
			this.gunEls[ side ] = { root: g, fill, name, label, status: make( 'em', '', g, '' ) };

		}

		// the target's hull, with the cripple mark (below the guns)
		this.tgtRow = make( 'div', 'nv-tgt', this.root );
		this.tgtName = make( 'span', 'nv-label', this.tgtRow, '' );
		const tbar = make( 'span', 'nv-bar', this.tgtRow );
		this.tgtFill = make( 'span', '', tbar );
		this.tgtMark = make( 'i', '', tbar );
		this.tgtNum = make( 'b', 'nv-num', this.tgtRow, '' );
		this.tgtPips = make( 'span', 'nv-pips', this.tgtRow );
		this._pipKey = '';
		this.noGunEl = make( 'div', 'nv-nogun', this.root, NO_GUN_TEXT );
		this.ammoEl = make( 'div', 'nv-ammo', this.root, '' );
		this.dcEl = make( 'div', 'nv-dc', this.root, '' );
		this.xhair = make( 'div', 'nv-xhair' );
		this.xread = make( 'div', 'nv-xread' );
		this.arrowLayer = make( 'div', 'nv-arrows' );
		this.hitEl = make( 'div', 'nv-hit' );
		this.dmgEl = make( 'div', 'nv-dmg' );
		this.dmgWedge = make( 'b', '', this.dmgEl );
		const body = doc.body;
		body.append( this.root, this.arrowLayer, this.hitEl, this.dmgEl, this.xhair, this.xread );
		this.aim = new AimAssist( { doc, css: false } );

	}

	hitMarker( kind = 'hit' ) {

		this.hitT = 0.28;
		this.hitKind = kind;

	}

	damageFrom( angle ) {

		this.dmgT = 1.1;
		this.dmgAngle = angle;

	}

	update( model, dt = 0.016 ) {

		if ( ! this.root ) return;
		const on = !! model.visible;
		this.root.classList.toggle( 'is-on', on );
		setStyle( this.arrowLayer, 'display', on ? '' : 'none' );
		if ( on ) {

			const h = model.hull;
			setNum( this.hullFill, 'transform', Math.max( 0, Math.min( 1, h.frac ) ), 3, 'scaleX(', ')' );
			this.hullRow.classList.toggle( 'is-low', h.low );
			setText( this.hullNum, h.sunk ? 'Sunk' : String( h.hp ) );
			for ( const g of model.guns ) {

				const e = this.gunEls[ g.side ];
				const text = g.count > 1 ? `${ e.label } x${ g.count }` : e.label; // a ship's broadside: "Port x4"
				if ( e.name.textContent !== text ) e.name.textContent = text;
				e.root.classList.toggle( 'is-off', ! g.owned );
				e.root.classList.toggle( 'is-ready', g.ready );
				e.root.classList.toggle( 'is-target', g.ready && g.range !== null && g.range !== undefined );
				setNum( e.fill, 'width', g.frac * 100, 0, '', '%' );
				// READY / seconds left, and the range to what this side would hit
				const st = g.silent ? 'OUT OF ACTION' : g.dry ? 'NO SHOT'
					: ( g.ready ? 'READY' : `${ ( g.left || 0 ).toFixed( 1 ) } s` ) + ( g.range !== null && g.range !== undefined ? ` · ${ g.range } m` : '' );
				if ( e.status && e.status.textContent !== st ) e.status.textContent = st;

			}

			// the target's hull bar and the cripple line
			const tg = model.target;
			this.tgtRow.classList.toggle( 'is-on', !! tg );
			if ( tg ) {

				if ( this.tgtName.textContent !== tg.name ) this.tgtName.textContent = tg.name;
				setNum( this.tgtFill, 'width', tg.frac * 100, 1, '', '%' );
				setNum( this.tgtMark, 'left', tg.mark * 100, 1, '', '%' );
				this.tgtRow.classList.toggle( 'is-crippled', tg.crippled );
				const num = tg.crippled ? 'BOARD' : `${ Math.round( tg.frac * 100 ) }%`;
				if ( this.tgtNum.textContent !== num ) this.tgtNum.textContent = num;
				// her sections as pips (a flame first while she burns)
				const pips = tg.sections || [];
				const key = ( tg.fire > 0 ? 'f' : '' ) + pips.map( ( p ) => p.id + ( p.frac <= 0 ? 0 : p.frac < 0.5 ? 1 : 2 ) ).join( ',' );
				if ( key !== this._pipKey ) {

					this._pipKey = key;
					this.tgtPips.textContent = '';
					if ( tg.fire > 0 ) {

						const e = this._make( 'i', 'is-fire', this.tgtPips );
						e.title = 'On fire';

					}

					for ( const p of pips ) {

						const e = this._make( 'i', p.frac <= 0 ? 'is-gone' : p.frac < 0.5 ? 'is-hurt' : '', this.tgtPips );
						e.title = `${ p.label } ${ Math.round( p.frac * 100 ) } %`;

					}

				}

			}

			this.noGunEl.classList.toggle( 'is-on', !! model.noGun );
			// powder and shot aboard; "Out of shot" after a dry click
			const sh = model.ammo;
			const at = ! sh ? '' : model.outOfShot || sh.out ? OUT_OF_SHOT : `Shot ${ sh.rounds } / ${ sh.max }`;
			if ( this.ammoEl.textContent !== at ) this.ammoEl.textContent = at;
			this.ammoEl.classList.toggle( 'is-out', !! sh && ( sh.out || !! model.outOfShot ) );
			this.ammoEl.classList.toggle( 'is-low', !! sh && ! sh.out && sh.rounds <= Math.max( 2, sh.max * 0.2 ) );
			const dc = model.dc;
			this.dcEl.classList.toggle( 'is-on', !! dc );
			if ( dc ) {

				if ( this.dcEl.textContent !== dc.text ) this.dcEl.textContent = dc.text;
				this.dcEl.classList.toggle( 'is-urgent', !! dc.urgent );

			}

			const stamp = this._stamp = ( this._stamp || 0 ) + 1; // (no Set per frame)
			for ( const a of model.arrows ) {

				let e = this.arrows.get( a.id );
				if ( ! e ) {

					const root = this._make( 'div', 'nv-arrow', this.arrowLayer );
					e = { id: a.id, root, tri: this._make( 'i', '', root ), label: this._make( 'span', '', root, '' ), stamp: 0, dist: null };
					this.arrows.set( a.id, e );

				}

				e.stamp = stamp;

				setNum( e.root, 'left', a.x * 100, 1, '', '%' );
				setNum( e.root, 'top', a.y * 100, 1, '', '%' );
				setNum( e.tri, 'transform', a.angle, 3, 'rotate(', 'rad)' );
				if ( e.dist !== a.dist ) {

					e.dist = a.dist;
					e.label.textContent = `${ a.dist } m`;

				}
				e.root.classList.toggle( 'is-hunting', a.hunting );

			}

			for ( const e of this.arrows.values() ) {

				if ( e.stamp === stamp ) continue;
				e.root.remove();
				this.arrows.delete( e.id );

			}

		}

		// aiming by hand: the crosshair and the ranging readout
		const am = on ? model.aiming : null;
		this.xhair.classList.toggle( 'is-on', !! am );
		this.xread.classList.toggle( 'is-on', !! am );
		if ( am ) {

			this.xhair.classList.toggle( 'is-out', ! am.inArc );
			// third person: on the impact point (the readout just under it); first person: the CSS centre
			const sc = am.screen;
			const x = sc ? ( sc.x * 100 ).toFixed( 2 ) + '%' : '', y = sc ? ( sc.y * 100 ).toFixed( 2 ) + '%' : '';
			if ( this.xhair.style.left !== x ) {

				this.xhair.style.left = x;
				this.xread.style.left = x;

			}

			if ( this.xhair.style.top !== y ) {

				this.xhair.style.top = y;
				this.xread.style.top = sc ? `calc(${ y } + 22px)` : '';

			}

			const t = `${ am.side === 'port' ? 'PORT' : 'STBD' } · ${ am.inArc ? am.range + ' m' : 'out of arc' }${ am.part && am.part !== 'hull' ? ` · ${ AIM_LABELS[ am.part ] || am.part }` : '' }${ am.ready ? '' : ` · ${ am.left.toFixed( 1 ) } s` }`;
			if ( this.xread.textContent !== t ) this.xread.textContent = t;

		}

		if ( this.aim ) {

			if ( model.features ) this.aim.bind( model.features );
			this.aim.update( on ? model.aim : null, model.camera, arrowFor, dt );

		}

		if ( this.hitT > 0 ) {

			this.hitT -= dt;
			setStyle( this.hitEl, 'opacity', String( Math.max( 0, this.hitT / 0.28 ) ) );
			this.hitEl.classList.toggle( 'is-sunk', this.hitKind === 'sunk' );

		} else setStyle( this.hitEl, 'opacity', '0' );

		if ( this.dmgT > 0 ) {

			this.dmgT -= dt;
			setStyle( this.dmgEl, 'opacity', String( Math.max( 0, Math.min( 1, this.dmgT / 0.6 ) ) ) );
			setNum( this.dmgWedge, 'transform', this.dmgAngle, 3, 'rotate(', 'rad)' );

		} else setStyle( this.dmgEl, 'opacity', '0' );

	}

	dispose() {

		if ( ! this.root ) return;
		if ( this.aim ) this.aim.dispose();
		for ( const el of [ this.root, this.arrowLayer, this.hitEl, this.dmgEl, this.xhair, this.xread ] ) el.remove();
		this.arrows.clear();
		this.root = null;

	}

}
