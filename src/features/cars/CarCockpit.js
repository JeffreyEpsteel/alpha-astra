// One detailed local cabin; traffic retains the cheap instanced interior. Canvas instruments use the same
// GPU texture upload and eye/free-pointer panel picking convention as the seaplane cockpit.
import { Group, Mesh, BoxGeometry, TorusGeometry, BufferGeometry, BufferAttribute, Vector3, Quaternion, Color } from '../../engine/index.js';
import { mergeGeometries } from '../../engine/geometry/BufferGeometryUtils.js';
import { Material } from '../../engine/render/Material.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { GPU } from '../../engine/gpu/GPU.js';
import { carPanelSnapshot, carControl } from './CarSystems.js';

export const PANEL = { w: 1024, h: 320 };
export const CONTROLS = [
	{ id: 'engine', label: 'Engine start / stop', x: 704, y: 55, w: 142, h: 82 },
	{ id: 'lights', label: 'Headlights: auto / on / off', key: 'L', x: 862, y: 55, w: 142, h: 82 },
	{ id: 'park', label: 'Parking brake', x: 704, y: 155, w: 142, h: 82 },
	{ id: 'horn', label: 'Horn', key: 'H', x: 862, y: 155, w: 142, h: 82 },
	{ id: 'siren', label: 'Police siren', x: 704, y: 253, w: 300, h: 48, police: true },
];
const clamp = ( n, a, b ) => Math.max( a, Math.min( b, n ) );
const THEMES = {
	sedan: [ 0x382e25, 0xb1a18a, '#71e3c3' ], taxi: [ 0x332a19, 0xd2b16f, '#ffce75' ],
	police: [ 0x192631, 0x819caf, '#8ccfff' ], pickup: [ 0x3b3025, 0xa28b68, '#b5d8a3' ],
	van: [ 0x303634, 0x899b91, '#9ed5bf' ], sports: [ 0x191a1d, 0x9f3436, '#ffb093' ], bus: [ 0x243a33, 0x9eae8d, '#b8e6bb' ],
};
export const CABIN_STYLES = {
	sedan: { id: 'wood-saloon', label: 'Classic wood / twin analogue', instruments: 'twin-analogue', seat: 'piped', console: 'wood' },
	taxi: { id: 'taxi-duty', label: 'Taxi duty console', instruments: 'duty-display', seat: 'taxi', console: 'meter-housing' },
	police: { id: 'police-console', label: 'Police alert console', instruments: 'speed-tape', seat: 'partitioned', console: 'equipment-bank' },
	pickup: { id: 'utility-bench', label: 'Pickup utility / bench', instruments: 'square-utility', seat: 'bench', console: 'open-footwell' },
	van: { id: 'compact-utility', label: 'Van compact utility', instruments: 'compact-digital', seat: 'utility', console: 'storage' },
	sports: { id: 'sports-bucket', label: 'Sports tachometer / buckets', instruments: 'central-tachometer', seat: 'bucket', console: 'angular' },
	bus: { id: 'transit-console', label: 'Bus transit console', instruments: 'transit-display', seat: 'driver-pedestal', console: 'wide-transit' },
};

export function cockpitLayout( spec, bounds = null ) {

	const eye = spec.eye, van = spec.glb === 'cars/van.glb';
	// The van's forward driving position has much less panel depth than the passenger cars.
	// Keep its authored eye/seat; a compact raised cluster puts both numeric dials in the normal forward view.
	const w = van ? 0.78 : Math.min( spec.wid - 0.4, 1.32 );
	const z = Math.max( eye[ 2 ] + 0.4, Math.min( eye[ 2 ] + 0.78, bounds ? bounds.max.z - 0.22 : Infinity ) );
	return { x: van ? eye[ 0 ] - ( 0.5 - 157 / PANEL.w ) * w : Math.max( 0, eye[ 0 ] - 0.44 ), y: eye[ 1 ] - ( van ? 0.2 : 0.36 ), z, w, h: w * PANEL.h / PANEL.w, tilt: 0.15, eye,
		floor: spec.seat[ 1 ] - 0.08, back: bounds ? bounds.min.z + 0.12 : eye[ 2 ] - 0.9,
		front: bounds ? bounds.max.z - 0.08 : z + 0.24 };

}

export function hitCarControl( px, py, kind = 'sedan' ) {

	return CONTROLS.find( c => ( ! c.police || kind === 'police' ) && px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h ) || null;

}

export function rayCarPanel( origin, dir, L, maxT = 3 ) {

	const ny = Math.sin( L.tilt ), nz = - Math.cos( L.tilt ), dn = dir.y * ny + dir.z * nz;
	if ( dn >= - 0.0001 ) return null;
	const t = ( ( L.y - origin.y ) * ny + ( L.z - origin.z ) * nz ) / dn;
	if ( t <= 0 || t > maxT ) return null;
	const x = origin.x + dir.x * t - L.x, y = origin.y + dir.y * t - L.y, z = origin.z + dir.z * t - L.z;
	const u = 0.5 - x / L.w, v = 0.5 - ( y * Math.cos( L.tilt ) + z * Math.sin( L.tilt ) ) / L.h;
	return u < 0 || u > 1 || v < 0 || v > 1 ? null : { px: u * PANEL.w, py: v * PANEL.h, u, v, t };

}

export function panelGeometry( L ) {

	const p = [], n = [], uv = [ 0, 0, 1, 0, 1, 1, 0, 1 ];
	for ( const [ sx, sy ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) {

		p.push( L.x - sx * L.w / 2, L.y + sy * L.h / 2 * Math.cos( L.tilt ), L.z + sy * L.h / 2 * Math.sin( L.tilt ) );
		n.push( 0, Math.sin( L.tilt ), - Math.cos( L.tilt ) );

	}
	const g = new BufferGeometry();
	g.setAttribute( 'position', new BufferAttribute( new Float32Array( p ), 3 ) );
	g.setAttribute( 'normal', new BufferAttribute( new Float32Array( n ), 3 ) );
	g.setAttribute( 'uv', new BufferAttribute( new Float32Array( uv ), 2 ) );
	g.setIndex( new BufferAttribute( new Uint16Array( [ 0, 1, 2, 0, 2, 3 ] ), 1 ) );
	g.computeBoundingBox(); g.computeBoundingSphere(); return g;

}

function label( ctx, text, x, y, size = 16, color = '#e3e9e6', align = 'center' ) {

	ctx.font = `600 ${ size }px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText( text, x, y );

}

function dial( ctx, x, value, max, title, accent, digital, { y = 139, r = 102 } = {} ) {

	const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
	ctx.beginPath(); ctx.arc( x, y, r + 6, 0, Math.PI * 2 ); ctx.fillStyle = '#63716e'; ctx.fill();
	ctx.beginPath(); ctx.arc( x, y, r + 3, 0, Math.PI * 2 ); ctx.fillStyle = '#080e12'; ctx.fill();
	for ( let i = 0; i <= 24; i ++ ) {

		const a = a0 + sweep * i / 24, inner = r - ( i % 4 === 0 ? 17 : 8 );
		ctx.strokeStyle = i > 21 ? '#ef795b' : '#99afa7'; ctx.lineWidth = i % 4 === 0 ? 3 : 1;
		ctx.beginPath(); ctx.moveTo( x + Math.cos( a ) * inner, y + Math.sin( a ) * inner ); ctx.lineTo( x + Math.cos( a ) * ( r - 4 ), y + Math.sin( a ) * ( r - 4 ) ); ctx.stroke();
		if ( i % 4 === 0 ) label( ctx, String( Math.round( max * i / 24 ) ), x + Math.cos( a ) * ( r - 32 ), y + Math.sin( a ) * ( r - 32 ), 15, '#a9b8b2' );

	}
	const a = a0 + sweep * clamp( value / max, 0, 1 );
	ctx.beginPath(); ctx.moveTo( x, y ); ctx.lineTo( x + Math.cos( a ) * ( r - 16 ), y + Math.sin( a ) * ( r - 16 ) ); ctx.lineWidth = 4; ctx.strokeStyle = accent; ctx.stroke();
	ctx.beginPath(); ctx.arc( x, y, 8, 0, Math.PI * 2 ); ctx.fillStyle = accent; ctx.fill();
	label( ctx, title, x, y - 40, 14, '#abbeb5' );
	ctx.fillStyle = '#0c1e20'; ctx.fillRect( x - 58, y + 34, 116, 43 ); label( ctx, digital, x, y + 56, 31, accent );

}

function plate( ctx, x, y, w, h, color = '#1c2b31' ) {

	ctx.fillStyle = color; ctx.fillRect( x, y, w, h ); ctx.strokeStyle = '#637b79'; ctx.lineWidth = 2; ctx.strokeRect( x, y, w, h );

}

function bar( ctx, x, y, w, h, fraction, accent ) {

	ctx.fillStyle = '#354847'; ctx.fillRect( x, y, w, h ); ctx.fillStyle = accent; ctx.fillRect( x, y, w * clamp( fraction, 0, 1 ), h );

}

function instruments( ctx, s, accent ) {

	const speed = String( Math.round( s.speed ) ), rpm = String( Math.round( s.rpm / 10 ) * 10 ), max = Math.ceil( s.top / 20 ) * 20;
	switch ( s.kind ) {

		case 'taxi':
			dial( ctx, 157, s.speed, max, 'km/h', accent, speed );
			plate( ctx, 295, 61, 224, 174, '#17251c' );
			label( ctx, 'TAXI DUTY', 407, 81, 18, accent );
			label( ctx, s.engineOn ? s.parkBrake ? 'PARKED' : 'DRIVER ABOARD' : 'OFF DUTY', 407, 114, 19 );
			label( ctx, rpm + ' RPM', 407, 156, 30, accent );
			bar( ctx, 314, 181, 186, 8, s.rpm / 6500, accent );
			label( ctx, 'LAMPS ' + s.lightMode, 407, 214, 16, '#c6d1bf' );
			break;
		case 'police':
			plate( ctx, 49, 60, 218, 175, '#152c3a' );
			for ( let i = 0; i < 7; i ++ ) { ctx.fillStyle = '#89a5b2'; ctx.fillRect( 60, 75 + i * 22, i % 2 ? 12 : 20, 2 ); }
			label( ctx, 'ROAD SPEED', 167, 83, 15, '#b5d9e8' ); label( ctx, speed, 165, 145, 65, accent ); label( ctx, 'km/h', 165, 206, 17 );
			dial( ctx, 408, s.rpm / 1000, 7, 'RPM × 1000', accent, rpm, { r: 94 } );
			label( ctx, s.wanted ? 'CITY ALERT ' + s.wanted : 'CITY CLEAR', 602, 256, 13, s.wanted ? '#ffb178' : accent );
			break;
		case 'pickup':
			plate( ctx, 41, 61, 231, 175, '#282a26' ); label( ctx, 'ROAD SPEED', 156, 86, 15 ); label( ctx, speed, 156, 150, 65, accent ); label( ctx, 'km/h', 156, 209, 17 );
			plate( ctx, 300, 61, 218, 175, '#282a26' ); label( ctx, 'ENGINE RPM', 409, 86, 15 );
			for ( let i = 0; i < 12; i ++ ) { ctx.fillStyle = s.rpm / 6500 > i / 12 ? i > 9 ? '#ffaf7d' : accent : '#45534d'; ctx.fillRect( 318 + i * 15, 116, 10, 38 ); }
			label( ctx, rpm, 409, 195, 36, accent );
			break;
		case 'van':
			// Digital boxes retain their tested forward-view coordinates in the short van cab.
			for ( const x of [ 45, 296 ] ) plate( ctx, x, 63, 224, 173, '#17262c' );
			label( ctx, 'UTILITY / SPEED', 157, 85, 16 ); label( ctx, 'UTILITY / ENGINE', 408, 85, 16 );
			bar( ctx, 65, 112, 184, 18, s.speed / s.top, accent ); bar( ctx, 316, 112, 184, 18, s.rpm / 6500, accent );
			label( ctx, 'km/h', 157, 153, 17 ); label( ctx, 'RPM', 408, 153, 17 );
			label( ctx, speed, 157, 195, 34, accent ); label( ctx, rpm, 408, 195, 34, accent );
			break;
		case 'sports':
			label( ctx, 'ROAD SPEED', 158, 76, 16, '#d6b9af' ); label( ctx, speed, 158, 139, 76, accent ); label( ctx, 'km/h', 158, 192, 19 );
			label( ctx, s.grounded ? 'ROAD CONTACT' : 'AIRBORNE', 158, 228, 13, s.grounded ? '#b4c1bb' : '#ffaf7d' );
			dial( ctx, 408, s.rpm / 1000, 7, 'RPM × 1000', accent, rpm, { r: 108 } );
			break;
		case 'bus':
			plate( ctx, 35, 59, 248, 179, '#102b29' ); label( ctx, 'TRANSIT / km/h', 159, 81, 17, accent ); label( ctx, speed, 159, 145, 67, accent );
			label( ctx, s.parkBrake || s.brake ? 'BRAKE SET' : s.speed > 0.5 ? 'MOVING' : 'STOPPED', 159, 212, 18, s.brake ? '#ffca80' : '#d1e1d6' );
			plate( ctx, 307, 59, 211, 179, '#102b29' ); label( ctx, 'ENGINE RPM', 412, 81, 17 ); label( ctx, rpm, 412, 131, 36, accent );
			bar( ctx, 328, 169, 168, 16, s.rpm / 6500, accent ); label( ctx, 'LAMPS ' + s.lightMode, 412, 212, 15 );
			break;
		default:
			dial( ctx, 157, s.speed, max, 'km/h', accent, speed );
			dial( ctx, 408, s.rpm / 1000, 7, 'RPM × 1000', accent, rpm );

	}

}

export function drawCarPanel( ctx, s ) {

	const accent = ( THEMES[ s.kind ] || THEMES.sedan )[ 2 ], style = CABIN_STYLES[ s.kind ] || CABIN_STYLES.sedan;
	ctx.fillStyle = s.kind === 'sedan' ? '#29251f' : s.kind === 'sports' ? '#171b22' : s.kind === 'pickup' ? '#30332e' : '#111a20'; ctx.fillRect( 0, 0, PANEL.w, PANEL.h );
	if ( s.kind === 'sedan' ) for ( let y = 18; y < PANEL.h; y += 16 ) { ctx.fillStyle = y % 32 ? '#302a22' : '#332c24'; ctx.fillRect( 12, y, 1000, 2 ); }
	if ( s.kind === 'pickup' || s.kind === 'van' ) for ( const x of [ 22, 682, 1010 ] ) for ( const y of [ 22, 297 ] ) { ctx.beginPath(); ctx.arc( x, y, 4, 0, Math.PI * 2 ); ctx.fillStyle = '#a5b3a7'; ctx.fill(); }
	ctx.fillStyle = '#34423f'; ctx.fillRect( 14, 13, 996, 3 );
	label( ctx, s.kind === 'bus' ? 'MERIDIAN TRANSIT / DRIVER CONSOLE' : 'MERIDIAN  /  ' + s.name.toUpperCase(), 24, 31, 16, '#b2c6bd', 'left' );
	instruments( ctx, s, accent );
	label( ctx, s.gear, 602, 102, 57, s.parkBrake ? '#ffc677' : accent );
	label( ctx, style.seat === 'bucket' ? 'SPORT / AUTO' : 'AUTOMATIC', 602, 152, 13, '#b2c6bd' );
	label( ctx, 'CONDITION ' + Math.round( s.hp ) + '%', 602, 199, 14, s.hp < 45 ? '#ffa27b' : '#b2c6bd' );
	ctx.fillStyle = '#263e40'; ctx.fillRect( 535, 219, 135, 8 ); ctx.fillStyle = s.hp < 45 ? '#f28b6e' : accent; ctx.fillRect( 535, 219, 135 * s.hp / 100, 8 );
	const status = s.hp <= 0 ? 'ENGINE DAMAGED' : s.hp < 45 ? 'SERVICE REQUIRED' : ! s.grounded ? 'WHEELS OFF GROUND' : s.brake ? 'BRAKE' : s.engineOn ? 'ENGINE RUNNING' : 'ENGINE OFF';
	label( ctx, status, 338, 274, 17, s.brake || s.hp < 45 ? '#ffc677' : '#9bb4aa' );
	label( ctx, '3  CONTROLS     ·     V  CAMERA     ·     E  EXIT WHEN SLOW', 340, 303, 12, '#b2c6bd' );
	for ( const c of CONTROLS ) {

		if ( c.police && s.kind !== 'police' ) continue;
		const on = c.id === 'engine' ? s.engineOn : c.id === 'lights' ? s.lights : c.id === 'park' ? s.parkBrake : c.id === 'horn' ? s.horn : s.siren;
		ctx.fillStyle = s.hover === c.id ? '#456064' : '#23343b'; ctx.fillRect( c.x, c.y, c.w, c.h );
		ctx.strokeStyle = on ? accent : '#536a69'; ctx.lineWidth = on ? 3 : 1; ctx.strokeRect( c.x + 2, c.y + 2, c.w - 4, c.h - 4 );
		const title = { engine: 'ENGINE', lights: 'LAMPS  [L]', park: 'PARK BRAKE', horn: 'HORN  [H]', siren: 'POLICE SIREN' }[ c.id ];
		const state = c.id === 'engine' ? on ? 'STOP' : 'START' : c.id === 'lights' ? s.lightMode : c.id === 'horn' ? 'PRESS' : on ? 'ON' : 'OFF';
		label( ctx, title, c.x + c.w / 2, c.y + ( c.h < 50 ? 14 : 23 ), 14, '#c7d6d0' );
		label( ctx, state, c.x + c.w / 2, c.y + ( c.h < 50 ? 34 : 57 ), 19, on ? accent : '#d3ded9' );

	}

}

const CSS = `
.car-driver-tip{position:absolute;left:50%;bottom:calc(38 * var(--tw-u));transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:#101e29e8;color:#cce9df;font:600 13px system-ui;pointer-events:none;z-index:5}
.car-driver-panel{position:absolute;left:50%;bottom:var(--tw-edge);transform:translateX(-50%);width:min(540px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow-y:auto;box-sizing:border-box;padding:18px;border-radius:16px;background:#122431f5;color:#deede8;box-shadow:0 12px 50px #0009;font:14px system-ui;z-index:7;pointer-events:auto}
.car-driver-panel[hidden],.car-driver-tip[hidden]{display:none}
.car-driver-panel h2{margin:0 0 10px;font-size:18px}.car-driver-output{font:600 17px monospace;color:#89e5cb;margin:10px 0}.car-driver-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.car-driver-panel button{padding:12px;color:#e0efe9;background:#294350;border:1px solid #789d99;border-radius:8px;cursor:pointer;font:600 14px system-ui;min-height:44px}.car-driver-panel button:focus-visible{outline:3px solid #91f5da;outline-offset:2px}.car-driver-panel button[aria-pressed=true]{background:#326756}.car-driver-panel p{color:#c1d3ce;line-height:1.5}.car-driver-close{width:100%;margin-top:10px}.car-driver-message{min-height:20px;color:#ffc677}
.car-cockpit .tw-plane,.car-cockpit .sp-strip{display:none!important}.tw-root.is-photo .car-driver-panel,.tw-root.is-photo .car-driver-tip{display:none}
.tw-root.is-touch .car-driver-tip{bottom:auto;top:calc(var(--tw-edge) + 80px);max-width:calc(100vw - 32px);text-align:center}
`;

export class CarCockpit {

	constructor( cars, { canvas = null, visual = cars.opts.render !== false } = {} ) {

		this.cars = cars; this.app = cars.app; this.visual = visual; this.canvas = canvas; this.ctx = null;
		this.group = null; this.record = null; this.layout = null; this.mesh = null; this.wheel = null; this.pedals = []; this.materials = [];
		this.tex = null; this.faceMaterial = null; this.hover = null; this.isOpen = false; this.el = null; this.tip = null; this._acc = 1; this.redraws = 0;
		this._onMove = e => { this.mouse = { x: e.clientX, y: e.clientY }; };
		this._onKey = e => {

			if ( ! this.isOpen ) return;
			if ( this.blocked() ) { this.close(); if ( [ 'Space', 'Enter', 'NumpadEnter' ].includes( e.code ) ) e.preventDefault(); return; }
			if ( e.code === 'Escape' || e.code === 'Digit3' ) { this.close(); e.preventDefault(); e.stopPropagation(); }
			// Input normally prevents Tab / Space; let the browser focus and activate these actual buttons.
			else if ( [ 'Tab', 'Space', 'Enter', 'NumpadEnter' ].includes( e.code ) ) e.stopPropagation();

		};
		this._onButton = e => {

			const b = e.target?.closest?.( '[data-car-control]' );
			if ( ! b ) return;
			if ( b.dataset.carControl === 'close' ) return this.close();
			const r = this.act( b.dataset.carControl ); if ( this.message ) this.message.textContent = r.ok ? '' : r.reason;

		};
		globalThis.window?.addEventListener?.( 'mousemove', this._onMove, { passive: true } );

	}

	get firstPerson() { return !! ( this.cars.drive && this.app.player?.vehicle === this.cars.vehicle && this.app.player.view === 'first' && ! this.app.freeCam ); }
	blocked() {

		const ui = this.app.ui?.ui, hud = this.app.game?.hud;
		if ( this.app.paused || this.app.menuOpen || this.app.input?.enabled === false || this.app.game?.guide?.open || ui?.helpOpen || ui?.panelOpen || ui?.photoMode || ui?._start || hud?.invOpen || hud?.standOpen || hud?.rosterOpen || hud?.catchOpen || this.cars.panel?.isOpen ) return true;
		// A second feature can open after our tray focused a native button (for example M -> map).
		// Skip Cars itself to avoid asking our own isOpen() recursively.
		for ( const { instance } of this.cars.features?.list?.values?.() || [] ) {

			if ( ! instance || instance === this.cars ) continue;
			if ( typeof instance.isOpen === 'function' ? instance.isOpen() : instance.isOpen ) return true;

		}
		return false;

	}
	act( id ) {

		if ( this.blocked() ) return { ok: false, reason: 'blocked' };
		const result = carControl( this.cars, id );
		if ( ! result.ok && result.reason?.startsWith( 'Stop before' ) ) this.cars._toast( result.reason, 1800 );
		return result;

	}

	// Accessible equivalent of the panel's physical switches. Opening it releases mouse capture; Escape returns to driving.
	open() {

		if ( ! this.cars.drive || this.blocked() || this.cars.features?.panelOpen?.() && ! this.isOpen ) return false;
		this.isOpen = true; this._dom();
		try { if ( globalThis.document?.pointerLockElement ) document.exitPointerLock?.(); } catch { /* no lock */ }
		globalThis.document?.addEventListener?.( 'keydown', this._onKey, true );
		this.el?.querySelector?.( 'button' )?.focus?.(); return true;

	}
	close() { this.isOpen = false; if ( this.el ) this.el.hidden = true; globalThis.document?.removeEventListener?.( 'keydown', this._onKey, true ); }

	setRecord( record ) {

		if ( record === this.record ) return;
		if ( this.record ) this.record.cockpitDetailed = false;
		this.close(); this._releaseVisual(); this.record = record; this.hover = null; this._lmb = false;
		if ( ! record ) { this.app.ui?.ui?.root?.classList?.remove( 'car-cockpit' ); if ( this.tip ) this.tip.hidden = true; }
		if ( record ) { this.layout = cockpitLayout( record.spec ); if ( this.visual && this.app.scene ) this._build(); }

	}

	_build() {

		this._releaseVisual();
		const r = this.record, L = this.layout, S = r.spec, theme = THEMES[ r.kind ] || THEMES.sedan;
		this.group = new Group(); this.group.name = 'car-local-cockpit'; this.app.scene.add( this.group );
		const parts = [];
		const box = ( x, y, z, w, h, d, hex, into = parts ) => {

			const g = new BoxGeometry( w, h, d ).translate( x, y, z ), rgb = new Color( hex ), c = new Float32Array( g.attributes.position.count * 3 );
			for ( let i = 0; i < c.length; i += 3 ) c.set( [ rgb.r, rgb.g, rgb.b ], i );
			g.setAttribute( 'color', new BufferAttribute( c, 3 ) ); into.push( g ); return g;

		};
		const w = S.wid - 0.24, seatZ = S.eye[ 2 ] - 0.25, style = CABIN_STYLES[ r.kind ] || CABIN_STYLES.sedan;
		this.group.userData.cabinStyle = style.id;
		box( 0, L.floor, ( L.back + L.front ) / 2, w, 0.08, L.front - L.back, 0x1a2025 );
		for ( const side of [ - 1, 1 ] ) {

			const sx = side * w / 2;
			box( sx, S.eye[ 1 ] - 0.53, ( L.back + L.front ) / 2, 0.07, 0.63, L.front - L.back, theme[ 0 ] );
			box( sx - side * 0.04, S.eye[ 1 ] - 0.29, ( L.back + L.front ) / 2, 0.028, 0.035, L.front - L.back, theme[ 1 ] );
			box( sx - side * 0.09, S.eye[ 1 ] - 0.58, S.eye[ 2 ] - 0.03, 0.14, 0.09, 0.48, 0x222b30 );
			box( sx - side * 0.085, S.eye[ 1 ] - 0.43, S.eye[ 2 ] + 0.13, 0.035, 0.035, 0.17, 0x9aa8aa );
			if ( r.kind === 'bus' && side < 0 || r.kind === 'pickup' ) continue;
			const x = side * S.seat[ 0 ];
			box( x, L.floor + 0.22, seatZ, 0.5, 0.18, 0.5, theme[ 0 ] );
			box( x, L.floor + 0.5, seatZ - 0.28, 0.5, 0.58, 0.14, theme[ 0 ] );
			box( x, L.floor + 0.87, seatZ - 0.27, 0.3, 0.2, 0.12, theme[ 0 ] );
			for ( const dx of [ - 0.2, 0.2 ] ) box( x + dx, L.floor + 0.37, seatZ, 0.04, 0.025, 0.44, theme[ 1 ] );
			if ( r.kind === 'sports' ) for ( const dx of [ - 0.23, 0.23 ] ) {

				box( x + dx, L.floor + 0.34, seatZ, 0.09, 0.22, 0.52, theme[ 1 ] );
				box( x + dx, L.floor + 0.62, seatZ - 0.23, 0.08, 0.48, 0.23, theme[ 1 ] );

			}
			if ( r.kind === 'sedan' ) for ( let j = - 2; j <= 2; j ++ ) box( x + j * 0.075, L.floor + 0.505, seatZ - 0.353, 0.012, 0.48, 0.009, theme[ 1 ] );
			if ( r.kind === 'taxi' ) for ( let j = - 1; j <= 1; j ++ ) box( x, L.floor + 0.51 + j * 0.12, seatZ - 0.355, 0.4, 0.025, 0.01, theme[ 1 ] );

		}
		box( 0, L.y - 0.01, L.z + 0.15, w - 0.04, L.h + 0.11, 0.24, 0x1c242a );
		box( 0, L.y + L.h / 2 + 0.03, L.z + 0.1, w, 0.04, 0.36, 0x242d32 );
		box( 0, L.y - L.h / 2 - 0.035, L.z - 0.01, w - 0.06, 0.025, 0.025, theme[ 1 ] );
		// Outer vents, console and metal footrest; all are merged into one local cabin mesh.
		for ( const x of [ - w * 0.44, w * 0.44 ] ) for ( let j = 0; j < 5; j ++ ) box( x, L.y - 0.06 + j * 0.025, L.z - 0.025, 0.09, 0.008, 0.018, 0x7c8d8c );
		const lower = L.y - L.h / 2 - 0.12;
		switch ( r.kind ) {

			case 'sedan':
				box( 0, L.floor + 0.22, S.eye[ 2 ] + 0.1, 0.24, 0.38, 0.8, 0x483723 );
				box( - w * 0.28, lower, L.z - 0.06, w * 0.36, 0.13, 0.06, 0x765a39 );
				box( - w * 0.28, lower, L.z - 0.095, 0.12, 0.018, 0.014, 0xc4b08c );
				break;
			case 'taxi':
				// Raised duty-display hood; it surrounds the live RPM/status screen, without a fictitious fare meter.
				box( L.x + 0.1 * L.w, L.y - L.h / 2 - 0.045, L.z - 0.035, L.w * 0.25, 0.055, 0.09, 0x8b703b );
				box( 0, L.floor + 0.24, S.eye[ 2 ] + 0.1, 0.32, 0.4, 0.65, 0x252b26 );
				for ( const x of [ - 0.1, 0.1 ] ) box( x, L.floor + 0.45, S.eye[ 2 ] - 0.02, 0.07, 0.025, 0.11, 0x998452 );
				break;
			case 'police':
				box( 0, L.floor + 0.29, S.eye[ 2 ] + 0.12, 0.38, 0.5, 0.84, 0x1a2734 );
				for ( let j = 0; j < 4; j ++ ) box( 0, L.floor + 0.55, S.eye[ 2 ] - 0.14 + j * 0.12, 0.32, 0.018, 0.055, 0x638293 );
				for ( const x of [ - w * 0.37, 0, w * 0.37 ] ) box( x, S.eye[ 1 ] - 0.2, S.eye[ 2 ] - 0.63, 0.035, 0.9, 0.04, 0x536672 );
				box( 0, S.eye[ 1 ] - 0.57, S.eye[ 2 ] - 0.63, w * 0.9, 0.06, 0.04, 0x536672 );
				break;
			case 'pickup':
				box( 0, L.floor + 0.22, seatZ, w * 0.85, 0.18, 0.55, theme[ 0 ] );
				box( 0, L.floor + 0.51, seatZ - 0.28, w * 0.85, 0.58, 0.14, theme[ 0 ] );
				for ( let j = - 3; j <= 3; j ++ ) box( j * w * 0.1, L.floor + 0.515, seatZ - 0.355, 0.018, 0.49, 0.012, theme[ 1 ] );
				box( - w * 0.28, lower, L.z - 0.06, w * 0.38, 0.14, 0.07, 0x514b3c );
				break;
			case 'van':
				// Narrow upright storage bins stay below the verified compact forward instrument cluster.
				for ( const x of [ - w * 0.22, 0 ] ) {

					box( x, lower - 0.04, L.z - 0.04, 0.23, 0.18, 0.08, 0x4b5853 );
					box( x, lower - 0.04, L.z - 0.086, 0.16, 0.1, 0.015, 0x1b2726 );

				}
				box( 0, L.floor + 0.18, S.eye[ 2 ] - 0.15, 0.26, 0.28, 0.37, 0x343e37 );
				break;
			case 'sports':
				box( 0, L.floor + 0.2, S.eye[ 2 ] + 0.12, 0.3, 0.34, 0.9, 0x25262b );
				for ( const side of [ - 1, 1 ] ) box( side * 0.16, L.floor + 0.35, S.eye[ 2 ] + 0.12, 0.035, 0.06, 0.88, theme[ 1 ] );
				for ( const side of [ - 1, 1 ] ) { const g = box( side * w * 0.3, lower, L.z - 0.05, w * 0.28, 0.055, 0.1, theme[ 1 ] ); g.translate( - side * w * 0.3, - lower, 0 ).rotateZ( side * 0.14 ).translate( side * w * 0.3, lower, 0 ); }
				break;
			case 'bus':
				box( S.eye[ 0 ], L.floor + 0.08, seatZ - 0.1, 0.42, 0.16, 0.48, 0x68756c );
				box( - w * 0.25, lower - 0.09, L.z - 0.12, w * 0.43, 0.23, 0.22, 0x405d4f );
				for ( let j = 0; j < 3; j ++ ) box( - w * 0.25, lower - 0.02 - j * 0.055, L.z - 0.24, w * 0.34, 0.015, 0.018, 0x8fa68f );
				break;

		}
		box( S.eye[ 0 ], S.eye[ 1 ] - 0.64, L.z - 0.12, 0.07, 0.07, 0.35, 0x26313a );
		const cabinMat = new Material( { name: 'car-local-trim', vertexColors: true, roughness: 0.8, side: 'double', surface: 's.emissive += s.albedo * 0.055;' } );
		this.materials.push( cabinMat );
		const merged = mergeGeometries( parts ); for ( const g of parts ) g.dispose();
		this.group.add( new Mesh( merged, cabinMat ) );
		// Wheel and spokes move together from the actual steering rack. The rim sits below the driver's horizon.
		this.wheel = new Group(); this.wheel.position.set( S.eye[ 0 ], S.eye[ 1 ] - 0.64, L.z - 0.29 ); this.wheel.rotation.x = 0.18;
		this.group.add( this.wheel );
		const rim = new Mesh( new TorusGeometry( 0.18, 0.023, 8, 40 ), cabinMat ); this.wheel.add( rim );
		rim.material = new Material( { name: 'car-wheel-rubber', color: new Color( 0x28323a ), roughness: 0.8, surface: 's.emissive += s.albedo * 0.06;' } ); this.materials.push( rim.material );
		const spokeParts = []; box( 0, 0, 0, 0.32, 0.035, 0.04, theme[ 1 ], spokeParts ); box( 0, - 0.07, 0, 0.035, 0.16, 0.04, theme[ 1 ], spokeParts ); box( 0, 0, - 0.018, 0.105, 0.075, 0.045, 0x26313a, spokeParts );
		const spokes = mergeGeometries( spokeParts ); for ( const g of spokeParts ) g.dispose(); this.wheel.add( new Mesh( spokes, cabinMat ) );
		// Rubber pedals animate with the same throttle/brake commands fed to physics.
		for ( const [ i, dx ] of [ 0.1, - 0.1 ].entries() ) {

			const pedal = new Mesh( new BoxGeometry( i ? 0.08 : 0.13, 0.025, 0.17 ), new Material( { name: 'car-pedal', color: new Color( 0x64716e ), roughness: 0.7 } ) );
			this.materials.push( pedal.material ); pedal.position.set( S.eye[ 0 ] + dx, L.floor + 0.1, L.z - 0.2 ); this.group.add( pedal ); this.pedals.push( pedal );

		}
		if ( ! this.canvas ) this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas( PANEL.w, PANEL.h ) : globalThis.document?.createElement?.( 'canvas' );
		if ( this.canvas ) { this.canvas.width = PANEL.w; this.canvas.height = PANEL.h; this.ctx = this.canvas.getContext( '2d' ); }
		const pixels = new Uint8Array( PANEL.w * PANEL.h * 4 ); for ( let i = 3; i < pixels.length; i += 4 ) pixels[ i ] = 255;
		this.tex = new Texture( { label: 'car.cockpit', width: PANEL.w, height: PANEL.h, format: 'rgba8unorm-srgb', mips: false, usage: [ 'sample', 'copyDst', 'render' ], data: pixels } );
		this.faceMaterial = new Material( { name: 'car-live-instruments', side: 'double', textures: { carFace: this.tex }, surface: `
	let face = textureSample( carFace, smpAnisoClamp, vec2f( in.uv.x, 1.0 - in.uv.y ) );
	s.albedo = face.rgb; s.roughness = 0.75; s.emissive = face.rgb * ( 0.38 + 0.55 * frame.night );
` } );
		this.materials.push( this.faceMaterial ); this.mesh = new Mesh( panelGeometry( L ), this.faceMaterial ); this.mesh.name = 'car-live-panel'; this.mesh.castShadow = false; this.group.add( this.mesh );
		r.cockpitDetailed = true; this._acc = 1;

	}

	_aimAt() {

		const cam = this.app.camera, r = this.cars.drive, input = this.app.input;
		if ( ! cam || ! r?.body || ! this.layout ) return null;
		const o = cam.position.clone(), d = new Vector3(), q = new Quaternion().copy( this.cars.quaternion ).invert();
		let free = false;
		if ( ! input?.locked && ! input?.touchMode && this.mouse && input?.dom?.getBoundingClientRect ) {

			const b = input.dom.getBoundingClientRect();
			if ( b.width && b.height ) { cam.updateMatrixWorld(); d.set( ( this.mouse.x - b.left ) / b.width * 2 - 1, 1 - ( this.mouse.y - b.top ) / b.height * 2, 0.5 ).unproject( cam ).sub( cam.position ).normalize(); free = true; }

		}
		if ( ! free ) d.set( 0, 0, - 1 ).applyQuaternion( cam.quaternion );
		o.sub( new Vector3( r.x, r.y + ( r.bump || 0 ), r.z ) ).applyQuaternion( q ); d.applyQuaternion( q );
		const hit = rayCarPanel( o, d, this.layout ); this.aim = hit;
		return hit ? hitCarControl( hit.px, hit.py, r.kind ) : null;

	}

	update( dt ) {

		if ( this.disposed ) return;
		this.setRecord( this.cars.drive );
		if ( this.isOpen && this.blocked() ) this.close();
		const r = this.record;
		if ( this.group ) {

			const bounds = this.cars.render?.sets.get( r.kind )?.cabinBounds;
			if ( bounds && bounds !== this._bounds ) { this.layout = cockpitLayout( r.spec, bounds ); this._build(); this._bounds = bounds; }
			this.group.position.set( r.x, r.y + ( r.bump || 0 ), r.z ); this.group.quaternion.copy( this.cars.quaternion );
			this.wheel.rotation.z = - ( r.body?.steer || 0 ) * 2.4;
			for ( const [ i, p ] of this.pedals.entries() ) p.rotation.x = - ( i ? r.body?.input.throttle || 0 : r.body?.input.brake || 0 ) * 0.3;

		}
		const fp = this.firstPerson, ui = this.app.ui?.ui;
		ui?.root?.classList?.toggle( 'car-cockpit', fp );
		const otherPanel = this.cars.features?.panelOpen?.() && ! this.isOpen;
		const hover = fp && ! this.isOpen && ! otherPanel && ! this.blocked() ? this._aimAt() : null;
		this.hover = hover?.id || null;
		const down = !! ( this.app.input?.mouseDown && this.app.input.enabled !== false );
		if ( down && ! this._lmb && hover ) this.act( hover.id ); this._lmb = down;
		this._acc += dt;
		if ( this._acc >= 0.1 && r ) {

			this._acc = 0; const snap = carPanelSnapshot( this.cars, this.hover ); this.snapshot = snap;
			if ( this.ctx && this.tex ) {

				drawCarPanel( this.ctx, snap ); this.redraws ++;
				if ( GPU.device ) {

					this.tex.getGPU();
					if ( ! GPU.queue?.copyExternalImageToTexture ) this._copyFailed = true;
					if ( GPU.queue?.copyExternalImageToTexture && ! this._copyFailed ) {

						try { GPU.queue.copyExternalImageToTexture( { source: this.canvas }, { texture: this.tex.gpu }, { width: PANEL.w, height: PANEL.h } ); }
						catch { this._copyFailed = true; }

					}
					if ( this._copyFailed && this.ctx.getImageData ) this.tex.upload( this.ctx.getImageData( 0, 0, PANEL.w, PANEL.h ).data );

				}

			}
			this._dom();

		}
		if ( this.tip ) { this.tip.hidden = ! fp || this.isOpen || !! otherPanel || this.blocked(); this.tip.textContent = hover ? hover.label + ( hover.key ? ' [' + hover.key + ']' : '' ) + ' · click' : 'Look at a dashboard switch and click · 3 controls'; }

	}

	_dom() {

		const host = this.app.ui?.ui?.hud || this.app.ui?.ui?.root, doc = globalThis.document;
		if ( ! host || ! doc || ! this.record ) return;
		if ( ! this.el ) {

			if ( ! doc.getElementById( 'car-cockpit-style' ) ) { const style = doc.createElement( 'style' ); style.id = 'car-cockpit-style'; style.textContent = CSS; doc.head.append( style ); }
			this.tip = doc.createElement( 'div' ); this.tip.className = 'car-driver-tip'; this.tip.hidden = true; host.append( this.tip );
			this.el = doc.createElement( 'section' ); this.el.className = 'car-driver-panel tw-interactive'; this.el.setAttribute( 'aria-label', 'Car dashboard controls' ); this.el.hidden = true;
			this.el.innerHTML = '<h2>Driver controls</h2><div class="car-driver-output" role="status"></div><div class="car-driver-grid"></div><p>W/S drive, brake and reverse · A/D steer · Space handbrake · L headlights · H horn · V camera. Stop before switching the engine. Close this panel to drive.</p><div class="car-driver-message"></div><button class="car-driver-close" data-car-control="close">Close · 3 / Escape</button>';
			this.el.addEventListener( 'click', this._onButton ); host.append( this.el ); this.message = this.el.querySelector( '.car-driver-message' );

		}
		this.el.hidden = ! this.isOpen;
		if ( ! this.isOpen ) return;
		const s = carPanelSnapshot( this.cars );
		this.el.querySelector( '.car-driver-output' ).textContent = `${ s.name } · ${ Math.round( s.speed ) } km/h · ${ s.gear } · ${ Math.round( s.rpm ) } RPM · ${ Math.round( s.hp ) }% condition`;
		const key = [ s.kind, s.engineOn, s.lights, s.lightMode, s.parkBrake, s.siren ].join( '|' );
		if ( key !== this._domKey ) {

			this._domKey = key;
			const focused = doc.activeElement?.dataset?.carControl;
			this.el.querySelector( '.car-driver-grid' ).innerHTML = CONTROLS.filter( c => ! c.police || s.kind === 'police' ).map( c => {

				const on = c.id === 'engine' ? s.engineOn : c.id === 'lights' ? s.lights : c.id === 'park' ? s.parkBrake : s.siren;
				const state = c.id === 'lights' ? s.lightMode : c.id === 'horn' ? '' : on ? 'on' : 'off';
				return `<button data-car-control="${ c.id }"${ c.id === 'horn' ? '' : ` aria-pressed="${ !! on }"` }>${ c.label }${ state ? ' · ' + state : '' }</button>`;

			} ).join( '' );
			if ( focused && focused !== 'close' ) this.el.querySelector( `[data-car-control="${ focused }"]` )?.focus();

		}

	}

	_releaseVisual() {

		if ( this.group ) { this.group.traverse( o => { if ( o.geometry ) o.geometry.dispose(); } ); this.group.removeFromParent(); }
		for ( const m of this.materials ) m.dispose(); this.materials.length = 0;
		this.tex?.destroy(); this.tex = null; this.group = this.mesh = this.wheel = null; this.pedals.length = 0; this._bounds = null;

	}

	dispose() {

		this.close(); this.setRecord( null ); this.disposed = true;
		this.app.ui?.ui?.root?.classList?.remove( 'car-cockpit' );
		globalThis.window?.removeEventListener?.( 'mousemove', this._onMove );
		this.el?.removeEventListener?.( 'click', this._onButton ); this.el?.remove(); this.tip?.remove(); this.el = this.tip = null;

	}

}
