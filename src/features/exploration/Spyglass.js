// The spyglass (docs/UNREAL_PARITY.md W15): G raises it (x4), G again closer (x9), a third time lowers it; Escape too.
// The view narrows (the camera's fov over the zoom, mouse look slowed to match) inside a round eyepiece, and what is
// in the glass gets a small label: ships (name, flag), ports, wrecks, the caches you know of and the inverted
// landmark, each with its distance. Hold an undiscovered cache in the middle of the glass for a moment and it is
// spotted (marked on your chart). Not while swimming.
//
//   const sg = new Spyglass( app, features, { treasure, key } );  sg.toggle()  sg.close()  sg.zoom (0 when down)
//   sg.update( dt )   (runs after CameraFeel in the frame, so the zoomed fov is the one drawn)
//   spyTargets( app, features, treasure ) -> [ { kind, x, y, z, label, sub, range } ]       (pure)
//   project( camera, p, out ) -> { x, y } in 0..1 screen space, or null behind the camera  (pure)

import { Vector3 } from '../../engine/math/Vector3.js';
import { WORLD } from '../../world/WorldLayout.js';
import { t } from '../../i18n/index.js';

export const ZOOMS = [ 4, 9 ];
export const SPOT_SECONDS = 0.8;
export const SPOT_ANGLE = 2.5; // degrees from the middle of the glass
export const RANGES = { ship: 1600, port: 2600, wreck: 1000, treasure: 800, landmark: 3000 };
// the old wreck on the home beach by the boathouse (Village.js)
const BEACH_WRECK = { x: 102.5, z: - 49.8 };

const CSS = /* css */`
.sg-root { position: fixed; inset: 0; pointer-events: none; z-index: 6; opacity: 0; transition: opacity 220ms ease; }
.sg-root.is-on { opacity: 1; }
.sg-eye { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 36vmin, rgba(4,6,8,0.75) 39vmin, rgba(2,3,4,0.96) 44vmin); }
.sg-ret { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 1px solid rgba(255,255,255,0.45); border-radius: 50%; }
.sg-zoom { position: absolute; left: 50%; bottom: calc(50% - 41vmin); transform: translateX(-50%); font: 500 12px/1 var(--tw-mono, monospace); color: rgba(255,255,255,0.7); letter-spacing: 0.08em; }
.sg-lab { position: absolute; transform: translate(-50%, -100%); padding: 2px 7px; border-radius: 6px; background: rgba(10,16,24,0.6); color: #e9f1f7; font: 500 12px/1.3 var(--tw-font, sans-serif); white-space: nowrap; }
.sg-lab b { font-weight: 600; } .sg-lab i { font-style: normal; opacity: 0.7; margin-left: 6px; }
.sg-lab.k-pirate { color: #ffb4a8; } .sg-lab.k-navy { color: #b8d4ff; } .sg-lab.k-treasure { color: #ffe08a; }
`;

const _v = new Vector3();

export function project( camera, p, out = {} ) {

	if ( ! camera || ! camera.projectionMatrix ) return null;
	camera.updateMatrixWorld && camera.updateMatrixWorld();
	if ( camera.matrixWorldInverse && camera.matrixWorld ) camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();
	_v.set( p.x, p.y, p.z ).applyMatrix4( camera.matrixWorldInverse );
	if ( _v.z > - 0.5 ) return null; // behind (or at) the lens
	_v.applyMatrix4( camera.projectionMatrix );
	out.x = _v.x * 0.5 + 0.5;
	out.y = 0.5 - _v.y * 0.5;
	return out;

}

// everything the glass can put a name to
export function spyTargets( app, features, treasure = null ) {

	const out = [];
	const nv = features && features.get ? features.get( 'naval' ) : null;
	for ( const s of nv && Array.isArray( nv.ships ) ? nv.ships : [] ) {

		if ( ! s || ! Number.isFinite( s.x ) ) continue;
		const sinking = s.state === 'sinking' || s.alive === false;
		if ( s.state === 'gone' ) continue;
		out.push( { kind: sinking ? 'wreck' : 'ship', x: s.x, y: 4, z: s.z, label: s.name || t( 'spyglass.ship', 'Ship' ), sub: sinking ? t( 'spyglass.sinking', 'sinking' ) : s.faction || '', faction: s.faction || '', range: RANGES.ship } );

	}

	for ( const p of WORLD.ports || [] ) {

		const q = p.stand || ( p.dock && p.dock.position ) || p.center;
		if ( q ) out.push( { kind: 'port', x: q.x, y: 6, z: q.z, label: p.name || p.id, sub: t( 'spyglass.port', 'port' ), range: RANGES.port } );

	}

	out.push( { kind: 'wreck', x: BEACH_WRECK.x, y: 1, z: BEACH_WRECK.z, label: t( 'spyglass.oldWreck', 'Old wreck' ), sub: '', range: RANGES.wreck } );
	const sd = features && features.get ? features.get( 'shipdamage' ) : null;
	const wl = sd && typeof sd.wrecks === 'function' ? sd.wrecks() : [];
	for ( const w of Array.isArray( wl ) ? wl : [] ) if ( w && Number.isFinite( w.x ) ) out.push( { kind: 'wreck', x: w.x, y: 1, z: w.z, label: w.name || t( 'spyglass.wreck', 'Wreck' ), sub: '', range: RANGES.wreck } );
	if ( treasure && treasure.sites ) {

		for ( const s of treasure.sites ) {

			if ( treasure.claimed.has( s.id ) ) continue;
			const known = treasure.found.has( s.id );
			if ( s.kind === 'wreck' && known ) out.push( { kind: 'wreck', x: s.x, y: 0.5, z: s.z, label: t( 'spyglass.wreck', 'Wreck' ), sub: t( 'spyglass.below', 'below the surface' ), range: RANGES.wreck } );
			else out.push( { kind: 'treasure', x: s.x, y: s.y + 0.5, z: s.z, label: known ? s.label : null, id: s.id, known, range: RANGES.treasure } );

		}

	}

	const inv = features && features.get ? features.get( 'inverted' ) : null;
	if ( inv && inv.enabled && inv.layout ) {

		const l = inv.layout.find( ( s ) => s.landmark );
		if ( l ) out.push( { kind: 'landmark', x: l.x, y: l.y - 100, z: l.z, label: t( 'inverted.landmark', 'The Hanging Spire' ), sub: '', range: RANGES.landmark } );

	}

	return out;

}

export class Spyglass {

	constructor( app, features, { treasure = null, key = 'KeyG' } = {} ) {

		this.app = app;
		this.features = features || null;
		this.treasure = treasure;
		this.key = key;
		this.level = 0; // 0 down, 1 x4, 2 x9
		this.baseFov = null;
		this._sens = null;
		this._spot = { id: null, t: 0 };
		this.el = null;
		this.labels = []; // the labels shown last update: [ { kind, label, x, y, dist } ]
		this.spotted = 0;
		this.keyOk = features && features.claimKey ? features.claimKey( key, 'exploration' ) : true;

	}

	get zoom() {

		return this.level ? ZOOMS[ this.level - 1 ] : 0;

	}

	get active() {

		return this.level > 0;

	}

	canUse() {

		const p = this.app && this.app.player;
		return !! ( p && p.mode !== 'swim' && ! ( this.app && this.app.freeCam ) );

	}

	_baseFov() {

		const app = this.app || {};
		const cf = app.cameraFeel;
		if ( cf && typeof cf.baseFov === 'function' ) {

			try { const f = cf.baseFov(); if ( Number.isFinite( f ) && f > 5 ) return f; } catch ( e ) { /* fall through */ }

		}

		return app.camera && Number.isFinite( app.camera.fov ) ? app.camera.fov : 60;

	}

	toggle() {

		if ( ! this.level ) {

			if ( ! this.canUse() ) return false;
			this.baseFov = this._baseFov();
			this.level = 1;
			const inp = this.app && this.app.input;
			if ( inp && Number.isFinite( inp.sensitivity ) ) this._sens = { base: inp.sensitivity };

		} else if ( this.level < ZOOMS.length ) this.level ++;
		else this.close();
		this._applySens();
		return this.level > 0;

	}

	_applySens() {

		const inp = this.app && this.app.input, s = this._sens;
		if ( ! inp || ! s ) return;
		// someone (the settings) changed it meanwhile: that is the new base
		if ( s.last !== undefined && inp.sensitivity !== s.last ) s.base = inp.sensitivity;
		if ( this.level ) inp.sensitivity = s.last = s.base / Math.sqrt( this.zoom );
		else { inp.sensitivity = s.base; this._sens = null; }

	}

	close() {

		if ( ! this.level ) return;
		this.level = 0;
		this._applySens();
		const cam = this.app && this.app.camera;
		if ( cam && this.baseFov ) {

			cam.fov = this.baseFov;
			if ( cam.updateProjectionMatrix ) cam.updateProjectionMatrix();

		}

		this.baseFov = null;
		this._spot.id = null;
		this.labels = [];
		this._render();

	}

	_dom() {

		if ( this.el || typeof document === 'undefined' || ! document.createElement ) return this.el;
		try {

			if ( ! document.getElementById( 'sg-style' ) ) {

				const st = document.createElement( 'style' );
				st.id = 'sg-style';
				st.textContent = CSS;
				document.head.append( st );

			}

			const el = document.createElement( 'div' );
			el.className = 'sg-root';
			el.innerHTML = '<div class="sg-eye"></div><div class="sg-ret"></div><div class="sg-zoom"></div><div class="sg-labs"></div>';
			document.body.append( el );
			this.el = el;
			this._labs = el.querySelector( '.sg-labs' );
			this._zoomEl = el.querySelector( '.sg-zoom' );

		} catch ( e ) { this.el = null; }

		return this.el;

	}

	_render() {

		const el = this._dom();
		if ( ! el ) return;
		el.classList.toggle( 'is-on', this.active );
		if ( this._zoomEl ) this._zoomEl.textContent = this.active ? `x${ this.zoom }` : '';
		if ( ! this._labs ) return;
		const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ] );
		this._labs.innerHTML = this.labels.map( ( l ) => `<div class="sg-lab k-${ esc( l.faction || l.kind ) }" style="left:${ ( l.x * 100 ).toFixed( 2 ) }%;top:${ ( l.y * 100 ).toFixed( 2 ) }%"><b>${ esc( l.label ) }</b>${ l.sub ? ` · ${ esc( l.sub ) }` : '' }<i>${ l.dist >= 1000 ? ( l.dist / 1000 ).toFixed( 1 ) + ' km' : Math.round( l.dist ) + ' m' }</i></div>` ).join( '' );

	}

	update( dt ) {

		const app = this.app || {};
		const inp = app.input;
		if ( this.keyOk !== false && inp && inp.hit && inp.hit( this.key ) && ! ( this.features && this.features.panelOpen && this.features.panelOpen() ) ) this.toggle();
		if ( ! this.level ) return;
		if ( ! this.canUse() ) { this.close(); return; }
		const cam = app.camera;
		if ( ! cam ) return;
		// the zoomed view: written after CameraFeel each frame, so it is the fov drawn
		const fov = this.baseFov / this.zoom;
		if ( cam.fov !== fov ) {

			cam.fov = fov;
			if ( cam.updateProjectionMatrix ) cam.updateProjectionMatrix();

		}

		this._label( dt );

	}

	_label( dt ) {

		const app = this.app || {}, cam = app.camera;
		const cp = cam.position;
		const fwd = _fwd( cam );
		const out = [];
		let centre = null, centreAng = SPOT_ANGLE;
		const scr = {};
		for ( const tg of spyTargets( app, this.features, this.treasure ) ) {

			const dx = tg.x - cp.x, dy = tg.y - cp.y, dz = tg.z - cp.z;
			const dist = Math.hypot( dx, dy, dz );
			if ( dist > tg.range || dist < 3 ) continue;
			const ang = Math.acos( Math.max( - 1, Math.min( 1, ( dx * fwd.x + dy * fwd.y + dz * fwd.z ) / dist ) ) ) * 180 / Math.PI;
			if ( tg.kind === 'treasure' && ! tg.known && ang < centreAng ) { centre = tg; centreAng = ang; }
			if ( ! tg.label ) continue;
			const s = project( cam, tg, scr );
			if ( ! s ) continue;
			// inside the round eyepiece only (about 36 % of the short side from the middle)
			const aspect = cam.aspect || 16 / 9;
			const ex = ( s.x - 0.5 ) * Math.max( 1, aspect ), ey = s.y - 0.5;
			if ( Math.hypot( ex, ey ) > 0.36 ) continue;
			out.push( { kind: tg.kind, faction: tg.faction, label: tg.label, sub: tg.sub, x: s.x, y: s.y, dist } );

		}

		out.sort( ( a, b ) => a.dist - b.dist );
		this.labels = out.slice( 0, 8 );
		// holding an unknown cache in the middle of the glass spots it
		if ( centre && this.treasure ) {

			if ( this._spot.id !== centre.id ) this._spot = { id: centre.id, t: 0 };
			this._spot.t += dt;
			if ( this._spot.t >= SPOT_SECONDS ) {

				if ( this.treasure.discover( centre.id, 'spyglass' ) ) this.spotted ++;
				this._spot = { id: null, t: 0 };

			}

		} else this._spot = { id: null, t: 0 };
		this._render();

	}

	dispose() {

		this.close();
		if ( this.el && this.el.remove ) this.el.remove();
		this.el = null;

	}

}

// the camera's forward vector (its -z axis in world space)
function _fwd( cam ) {

	cam.updateMatrixWorld && cam.updateMatrixWorld();
	const e = cam.matrixWorld.elements;
	const x = - e[ 8 ], y = - e[ 9 ], z = - e[ 10 ];
	const l = Math.hypot( x, y, z ) || 1;
	return { x: x / l, y: y / l, z: z / l };

}
