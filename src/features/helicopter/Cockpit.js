// Native WebGPU instrument face, ray-operated switches and accessible systems tray.
import { Mesh, BufferGeometry, BufferAttribute, Vector3, Quaternion } from '../../engine/index.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { GPU } from '../../engine/gpu/GPU.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { standard } from '../../materials/Materials.js';

export const TEX = Object.freeze( { w: 1536, h: 576 } );
export const FACE = { C: new Vector3( 0, 1.32, 1.565 ), R: new Vector3( - 1, 0, 0 ), U: new Vector3( 0, Math.cos( .22 ), Math.sin( .22 ) ), N: new Vector3( 0, Math.sin( .22 ), - Math.cos( .22 ) ), w: 1.72, h: .645 };
export const SWITCHES = [ [ 'engine', 'TURBINE', 'O' ], [ 'master', 'AVIONICS', 'U' ], [ 'hold', 'HOVER HOLD', 'Y' ], [ 'nav', 'NAV', 'N' ], [ 'landing', 'LANDING', ';' ], [ 'search', 'SEARCH', '' ], [ 'cabin', 'CABIN', '' ], [ 'ack', 'WARN ACK', '' ] ].map( ( [ id, label, key ], i ) => ( { id, label, key, x: 20 + i * 188, y: 461, w: 180, h: 92 } ) );
export function hitControl( x, y ) { return SWITCHES.find( c => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h ) || null; }
export function rayPanel( origin, direction ) {
	const dn = direction.dot( FACE.N ); if ( dn >= - .0001 ) return null;
	const t = FACE.C.clone().sub( origin ).dot( FACE.N ) / dn; if ( t <= 0 || t >= 3 ) return null;
	const p = direction.clone().multiplyScalar( t ).add( origin ).sub( FACE.C ), u = p.dot( FACE.R ) / FACE.w + .5, v = .5 - p.dot( FACE.U ) / FACE.h;
	return u < 0 || u > 1 || v < 0 || v > 1 ? null : { px: u * TEX.w, py: v * TEX.h, u, v, t };
}
export function buildFaceGeometry() {
	const positions = [], normals = [];
	for ( const [ x, y ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) { const p = FACE.C.clone().addScaledVector( FACE.R, x * FACE.w / 2 ).addScaledVector( FACE.U, y * FACE.h / 2 ); positions.push( p.x, p.y, p.z ); normals.push( FACE.N.x, FACE.N.y, FACE.N.z ); }
	const g = new BufferGeometry(); g.setAttribute( 'position', new BufferAttribute( new Float32Array( positions ), 3 ) ); g.setAttribute( 'normal', new BufferAttribute( new Float32Array( normals ), 3 ) ); g.setAttribute( 'uv', new BufferAttribute( new Float32Array( [ 0, 0, 1, 0, 1, 1, 0, 1 ] ), 2 ) ); g.setIndex( new BufferAttribute( new Uint16Array( [ 0, 1, 2, 0, 2, 3 ] ), 1 ) ); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
export function panelSnapshot( h ) {
	const f = h.flight, s = h.systems;
	return { speed: Math.hypot( f.velocity.x, f.velocity.z ) * 3.6, altitude: f.position.y - h.waterAt( f.position.x, f.position.z ), agl: f.agl, vs: f.velocity.y, heading: ( Math.atan2( Math.sin( f.yaw ), - Math.cos( f.yaw ) ) * 180 / Math.PI + 360 ) % 360, pitch: f.pitch * 180 / Math.PI, bank: f.roll * 180 / Math.PI, rpm: f.rpm * 100, hp: h.hp, engine: s.running || s.starting > 0, starting: s.starting > 0, master: s.master, hold: !! s.hold, nav: s.nav, landing: s.landing, search: s.search, cabin: s.cabin, warnings: s.warnings.slice(), flashing: s.flashing, grounded: f.grounded };
}
const C = { ink: '#edf5e5', dim: '#92a7a3', aqua: '#69e6d1', amber: '#ffbc70', red: '#ff695c' };
function label( c, t, x, y, size = 28, color = C.ink, align = 'left' ) { c.font = `600 ${ size }px ui-monospace,monospace`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText( t, x, y ); }
function rect( c, x, y, w, h, color ) { c.fillStyle = color; c.fillRect( x, y, w, h ); }
function line( c, x, y, xx, yy, color, width = 3 ) { c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo( x, y ); c.lineTo( xx, yy ); c.stroke(); }
export function drawPanel( c, s, hover = null ) {
	rect( c, 0, 0, TEX.w, TEX.h, '#152328' );
	for ( const x of [ 10, TEX.w - 10 ] ) for ( const y of [ 10, TEX.h - 10 ] ) { c.beginPath(); c.arc( x, y, 4, 0, Math.PI * 2 ); c.fillStyle = '#a5aaa0'; c.fill(); }
	label( c, 'COASTAL RESCUE  /  ROTORCRAFT', 30, 36, 25, C.dim );
	label( c, s.master ? ( s.starting ? 'STARTING' : s.engine ? 'TURBINE RUN' : 'TURBINE OFF' ) : 'AVIONICS OFF · U / SWITCH TO POWER', 1505, 36, 25, s.engine ? C.aqua : C.amber, 'right' );
	// Unpowered screens leave engraved hardware labels and controls visible in daylight.
	for ( const x of [ 20, 380, 800, 1160 ] ) rect( c, x, 70, x === 380 ? 400 : 340, 370, '#081115' );
	if ( s.master ) {
		label( c, 'GROUND SPEED', 42, 102, 24, C.dim ); label( c, s.speed.toFixed( 0 ), 42, 170, 78, C.ink ); label( c, 'km/h', 255, 184, 27, C.dim );
		label( c, 'ROTOR', 42, 255, 26, C.dim ); label( c, s.rpm.toFixed( 0 ) + '%', 42, 308, 64, s.rpm >= 80 ? C.aqua : C.amber );
		rect( c, 42, 357, 290, 18, '#26353a' ); rect( c, 42, 357, Math.max( 0, Math.min( 1, s.rpm / 100 ) ) * 290, 18, s.rpm >= 80 ? C.aqua : C.amber );
		label( c, s.grounded ? 'SKIDS ON GROUND' : s.hold ? 'POSITION HOLD' : 'MANUAL FLIGHT', 42, 412, 23, s.hold ? C.aqua : C.dim );
		// Clipped artificial horizon: roll rotates the earth; pitch moves its horizon.
		c.save(); c.beginPath(); c.rect( 400, 88, 360, 273 ); c.clip(); c.translate( 580, 224 ); c.rotate( - s.bank * Math.PI / 180 ); const py = s.pitch * 4;
		rect( c, - 500, - 500 + py, 1000, 500, '#286f91' ); rect( c, - 500, py, 1000, 500, '#785337' ); line( c, - 500, py, 500, py, '#f5e5bf', 4 );
		for ( const d of [ - 20, - 10, 10, 20 ] ) { const y = py - d * 4; line( c, - 55, y, 55, y, C.ink, 2 ); label( c, String( Math.abs( d ) ), 75, y, 21 ); }
		c.restore(); line( c, 455, 224, 540, 224, C.amber, 7 ); line( c, 620, 224, 705, 224, C.amber, 7 ); line( c, 540, 224, 580, 240, C.amber, 7 ); line( c, 580, 240, 620, 224, C.amber, 7 );
		label( c, 'HDG ' + String( Math.round( s.heading ) % 360 ).padStart( 3, '0' ) + '°', 580, 402, 37, C.ink, 'center' );
		label( c, 'ALTITUDE / m ASL', 822, 102, 24, C.dim ); label( c, s.altitude.toFixed( 0 ), 822, 170, 72 );
		label( c, 'AGL / m', 822, 253, 26, C.dim ); label( c, s.agl.toFixed( 0 ), 822, 310, 64, s.agl < 10 ? C.amber : C.aqua ); label( c, 'VSI ' + ( s.vs >= 0 ? '+' : '' ) + s.vs.toFixed( 1 ) + ' m/s', 822, 411, 28 );
		label( c, 'AIRFRAME', 1182, 103, 26, C.dim ); label( c, Math.round( s.hp ) + '%', 1182, 165, 65, s.hp < 50 ? C.red : C.aqua );
		line( c, 1182, 222, 1480, 222, '#33484c', 2 ); label( c, 'CAUTION', 1182, 258, 25, C.dim );
		if ( s.warnings.length ) s.warnings.forEach( ( w, i ) => label( c, w, 1182, 305 + i * 34, 25, s.flashing ? C.red : C.amber ) );
		else { label( c, 'SYSTEMS NORMAL', 1182, 310, 25, C.aqua ); label( c, 'O start / stop', 1182, 355, 22, C.dim ); label( c, '3 systems tray', 1182, 392, 22, C.dim ); }
	} else label( c, 'BATTERY / AVIONICS OFF', 768, 255, 44, '#718781', 'center' );
	for ( const b of SWITCHES ) {
		const on = b.id === 'ack' ? s.warnings.length > 0 : s[ b.id ]; rect( c, b.x, b.y, b.w, b.h, hover === b.id ? '#35575a' : '#23363b' ); rect( c, b.x + 12, b.y + 12, 10, 10, on ? b.id === 'ack' ? C.amber : C.aqua : '#677572' ); label( c, b.label, b.x + b.w / 2, b.y + 39, 21, C.ink, 'center' ); label( c, b.key || ( b.id === 'search' ? 'LOOK TO AIM' : b.id === 'ack' ? 'ACKNOWLEDGE' : 'CLICK' ), b.x + b.w / 2, b.y + 70, 18, C.dim, 'center' );
	}
}

export class HelicopterCockpit {
	constructor( h, { canvas = null } = {} ) {
		this.h = h; this.app = h.app; this.open = false; this.elapsed = 1; this._lmb = false; this.hover = null;
		this.canvas = canvas || ( typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas( TEX.w, TEX.h ) : typeof document !== 'undefined' ? Object.assign( document.createElement( 'canvas' ), { width: TEX.w, height: TEX.h } ) : null ); this.ctx = this.canvas?.getContext?.( '2d' );
		if ( h.visual ) {
			const data = new Uint8Array( TEX.w * TEX.h * 4 ); for ( let i = 0; i < data.length; i += 4 ) { data[ i ] = 21; data[ i + 1 ] = 35; data[ i + 2 ] = 40; data[ i + 3 ] = 255; }
			this.tex = new Texture( { label: 'rescue-helicopter-instruments', width: TEX.w, height: TEX.h, format: 'rgba8unorm-srgb', mips: ! this.app.input?.touchMode, usage: [ 'sample', 'copyDst', 'render' ], data } );
			this.material = standard( { textures: { heliPanel: this.tex }, uniforms: { glow: [ 'f32', 1 ] }, side: 'double', surface: 'let t = textureSample(heliPanel, smpAnisoClamp, vec2f(in.uv.x, 1.0-in.uv.y)); s.albedo=t.rgb; s.roughness=0.65; s.metalness=0.0; s.emissive=t.rgb*mat.glow*(0.2+frame.night*1.2);' } );
			this.mesh = new Mesh( buildFaceGeometry(), this.material ); this.mesh.name = 'live-rescue-flight-panel'; h.visual.root.add( this.mesh );
		}
		this._move = e => { this.mouse = { x: e.clientX, y: e.clientY }; }; this._escape = e => { if ( e.code === 'Escape' && this.open ) { this.close(); e.preventDefault(); e.stopImmediatePropagation(); } };
		if ( typeof window !== 'undefined' ) { window.addEventListener( 'mousemove', this._move ); window.addEventListener( 'keydown', this._escape, true ); }
	}
	close() { this.open = false; if ( this.tray ) this.tray.hidden = true; }
	toggle() {
		this.open = ! this.open;
		// Input tracks the browser's pointerlockchange; it has no unlock() method.
		// Mark the feature open first so PauseMenu treats this release as a modal.
		if ( this.open && globalThis.document?.pointerLockElement ) { try { document.exitPointerLock?.(); } catch { /* browsers without pointer lock still expose the tray */ } }
		this.dom();
	}
	aim() {
		const cam = this.app.camera; if ( ! cam ) return null;
		const origin = cam.position.clone(), direction = new Vector3( 0, 0, - 1 ).applyQuaternion( cam.quaternion ), inp = this.app.input;
		if ( ! inp?.locked && ! inp?.touchMode && this.mouse && inp?.dom?.getBoundingClientRect ) { const r = inp.dom.getBoundingClientRect(); if ( r.width && r.height ) { cam.updateMatrixWorld?.(); direction.set( ( this.mouse.x - r.left ) / r.width * 2 - 1, 1 - ( this.mouse.y - r.top ) / r.height * 2, .5 ).unproject( cam ).sub( origin ).normalize(); } }
		if ( this.h.systems.search ) this.h.systems.aim( direction );
		const inv = new Quaternion().copy( this.h.flight.quaternion ).invert(); origin.sub( this.h.flight.position ).applyQuaternion( inv ); direction.applyQuaternion( inv ); this.hit = rayPanel( origin, direction );
		return this.hit ? hitControl( this.hit.px, this.hit.py ) : null;
	}
	update( dt ) {
		const h = this.h, first = h.piloted && this.app.player?.view === 'first', blocked = h.blocked();
		if ( ! h.piloted || h.blocked( true ) ) this.close();
		this.hover = first && ! blocked ? this.aim() : null;
		const down = !! ( this.app.input?.mouseDown && this.app.input?.enabled !== false ); if ( down && ! this._lmb && this.hover ) h.act( this.hover.id ); this._lmb = down;
		this.elapsed += dt; if ( this.elapsed >= ( first ? .1 : h.piloted ? .3 : 1 ) ) { this.elapsed = 0; this.draw(); this.dom(); }
		if ( this.material ) this.material.uniforms.glow.value = h.systems.master ? 1 : 0;
		if ( this.tip ) { this.tip.hidden = ! first || blocked; this.tip.textContent = this.hover ? '● ' + this.hover.label + ( this.hover.key ? ' [' + this.hover.key + ']' : '' ) + ' · click' : 'Look down to instruments · aim and click switches · 3 systems'; }
	}
	draw() {
		if ( ! this.ctx ) return;
		const snapshot = panelSnapshot( this.h ), signature = JSON.stringify( snapshot, ( k, v ) => typeof v === 'number' ? Math.round( v * 10 ) / 10 : v ) + ( this.hover?.id || '' );
		if ( signature === this.signature ) return; this.signature = signature; drawPanel( this.ctx, snapshot, this.hover?.id );
		if ( ! this.tex ) return;
		if ( GPU.device && ! this.tex.gpu ) this.tex.getGPU();
		if ( GPU.device && GPU.queue?.copyExternalImageToTexture && this.tex.gpu && ! this.noCopy ) { try { GPU.queue.copyExternalImageToTexture( { source: this.canvas }, { texture: this.tex.gpu }, { width: TEX.w, height: TEX.h } ); if ( this.tex.mipLevelCount > 1 ) generateMipmaps( this.tex ); return; } catch { this.noCopy = true; } }
		if ( this.ctx.getImageData ) { const pixels = this.ctx.getImageData( 0, 0, TEX.w, TEX.h ).data; const bytes = new Uint8Array( pixels.buffer, pixels.byteOffset, pixels.byteLength ); if ( GPU.device && this.tex.gpu ) { this.tex.upload( bytes ); if ( this.tex.mipLevelCount > 1 ) generateMipmaps( this.tex ); } else this.tex.pendingData = bytes; }
	}
	dom() {
		if ( typeof document === 'undefined' || ! document.body ) return;
		if ( ! this.tray ) {
			this.tray = document.createElement( 'section' ); this.tray.setAttribute( 'role', 'dialog' ); this.tray.setAttribute( 'aria-label', 'Rescue helicopter systems' ); this.tray.style.cssText = 'position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(580px,92vw);max-height:70vh;overflow:auto;background:#142b30f7;border:1px solid #6cad9b;padding:18px;border-radius:14px;z-index:190;color:#eaf3de;font:14px/1.5 system-ui;box-shadow:0 8px 40px #0008';
			const title = document.createElement( 'strong' ); title.textContent = 'COASTAL RESCUE · COCKPIT SYSTEMS'; this.tray.append( title );
			this.status = document.createElement( 'p' ); this.tray.append( this.status );
			const grid = document.createElement( 'div' ); grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px'; this.buttons = new Map();
			for ( const s of [ ...SWITCHES, { id: 'panel', label: 'RESUME FLIGHT', key: '3 / Esc' } ] ) { const b = document.createElement( 'button' ); b.type = 'button'; b.style.cssText = 'min-height:48px;padding:9px;border:1px solid #77988e;border-radius:7px;background:#243f44;color:#edf4df;font:600 13px system-ui;cursor:pointer'; b.addEventListener( 'click', e => { e.stopPropagation(); this.h.act( s.id, 'tray' ); this.dom(); } ); grid.append( b ); this.buttons.set( s.id, { el: b, def: s } ); }
			this.tray.append( grid ); const notes = document.createElement( 'p' ); notes.textContent = 'Boarding auto-cranks the turbine. Wait for rotor ≥80%. O starts/stops on ground; U powers avionics. Y holds position and altitude; manual input releases. Searchlight follows your cockpit view. Flight controls pause while this tray is open. Shift rise · C descend · Space brake · V view · E exit after landing.'; notes.style.cssText = 'font-size:12px;color:#b7cbc1;margin-bottom:0'; this.tray.append( notes ); this.tray.addEventListener( 'pointerdown', e => e.stopPropagation() ); document.body.append( this.tray );
			this.tip = document.createElement( 'div' ); this.tip.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);padding:5px 10px;background:#12282bd9;color:#e7edd5;border-radius:6px;font:12px system-ui;pointer-events:none;z-index:84;max-width:80vw;text-align:center'; document.body.append( this.tip );
		}
		this.tray.hidden = ! this.open; if ( ! this.open ) return;
		const s = panelSnapshot( this.h ); this.status.textContent = `${ s.starting ? 'STARTING' : s.engine ? 'TURBINE RUNNING' : 'TURBINE OFF' } · ROTOR ${ Math.round( s.rpm ) }% · ${ Math.round( s.speed ) } km/h · ALT ${ Math.round( s.altitude ) } m · AGL ${ Math.round( s.agl ) } m · VSI ${ s.vs.toFixed( 1 ) } m/s · HULL ${ Math.round( s.hp ) }%${ s.warnings.length ? ' · ' + s.warnings.join( ' · ' ) : '' }`;
		for ( const [ id, b ] of this.buttons ) { const on = id === 'ack' ? s.warnings.length > 0 : !! s[ id ]; b.el.textContent = b.def.label + ( id === 'panel' ? '' : ' · ' + ( on ? 'ON' : 'OFF' ) ) + ( b.def.key ? ' [' + b.def.key + ']' : '' ); if ( id !== 'panel' && id !== 'ack' ) b.el.setAttribute( 'aria-pressed', String( on ) ); b.el.style.borderColor = on ? '#6ee3be' : '#77988e'; }
	}
	dispose() { this.close(); if ( typeof window !== 'undefined' ) { window.removeEventListener( 'mousemove', this._move ); window.removeEventListener( 'keydown', this._escape, true ); } this.tray?.remove(); this.tip?.remove(); this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); this.material?.dispose(); this.tex?.destroy(); }
}
