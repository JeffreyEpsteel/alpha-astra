import { Mesh, Group, TorusGeometry, CircleGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { THROW } from './MeleeData.js';

// The wind-up telegraph on the ground: while a raider winds up, a red ring marks the reach of his blow
// and flashes, and a red disc fills from the middle to the ring as the strike gets closer. Both are flat
// unlit transparent meshes (the built-in material fields only: no custom shader code), on the transparent
// layer like the contact shadows. One pair per raider slot, created on first use and hidden otherwise.
// Wave 4: in the parry window (r.parryCue > 0, the last 0.26 s) the ring turns gold and stops flashing: raise the guard now.
// Wave 12E: a thrower's wind-up ('throw') puts a smaller ring where the rock will land (r.throwAt), filling to the release.
//
//   const fx = new Telegraph( { scene } );
//   fx.update( raiders, time )     // raider: { id, x, y, z, alert, state, t, cfg: { windup, hitRange } }
//   fx.dispose()

const FLASH_HZ = 5; // flashes per second (rises to 9 at the strike)

export class Telegraph {

	constructor( { scene = null, radius = 2.4 } = {} ) {

		this.scene = scene;
		this.radius = radius;
		this.group = new Group();
		this.group.name = 'MeleeTelegraph';
		this.items = new Map(); // raider id -> { ring, fill, ringMat, fillMat }
		this.ringGeo = new TorusGeometry( radius, 0.07, 6, 48 );
		this.ringGeo.rotateX( Math.PI / 2 );
		this.fillGeo = new CircleGeometry( radius, 40 );
		this.fillGeo.rotateX( - Math.PI / 2 );
		if ( scene ) scene.add( this.group );

	}

	_material( name, opacity ) {

		return new Material( {
			name, lit: false, transparent: true, depthWrite: false, side: 'double', velocityWeight: 0,
			color: [ 0.9, 0.015, 0.01 ], emissive: [ 0.1, 0, 0 ], opacity,
		} );

	}

	_item( id ) {

		let it = this.items.get( id );
		if ( it ) return it;
		const ringMat = this._material( 'telegraph-ring', 0 ), fillMat = this._material( 'telegraph-fill', 0 );
		const ring = new Mesh( this.ringGeo, ringMat ), fill = new Mesh( this.fillGeo, fillMat );
		for ( const m of [ ring, fill ] ) {

			m.castShadow = false;
			m.receiveShadow = false;
			m.frustumCulled = false;
			m.visible = false;
			if ( m.layers && m.layers.set ) m.layers.set( LAYERS.TRANSPARENT );
			this.group.add( m );

		}

		fill.renderOrder = 1;
		ring.renderOrder = 2;
		it = { ring, fill, ringMat, fillMat };
		this.items.set( id, it );
		return it;

	}

	update( raiders, time ) {

		for ( const r of raiders ) {

			const thr = r.state === 'throw';
			const on = r.active && r.visible && r.alert && ( r.state === 'windup' || thr );
			let it = this.items.get( r.id );
			if ( ! on && ( ! it || ! it.ring.visible ) ) continue;
			it = this._item( r.id );
			if ( ! on ) {

				it.ring.visible = false;
				it.fill.visible = false;
				continue;

			}

			const k = Math.min( 1, r.t / ( thr ? THROW.windup : r.cfg.windup ) ); // 0 -> 1 over the telegraph
			const flash = 0.5 + 0.5 * Math.sin( time * Math.PI * 2 * ( FLASH_HZ + 4 * k ) );
			// the parry window (wave 4): the ring turns gold and holds steady, the cue to raise the guard
			const cue = r.parryCue || 0;
			const col = cue > 0 ? [ 1.0, 0.72, 0.05 ] : [ 0.9, 0.015, 0.01 ];
			if ( it.ringMat.color && it.ringMat.color.setRGB ) it.ringMat.color.setRGB( col[ 0 ], col[ 1 ], col[ 2 ] );
			else it.ringMat.color = col;
			const s = ( thr ? THROW.ring : r.cfg.hitRange ) / this.radius;
			const at = thr && r.throwAt ? r.throwAt : r;
			const y = ( Number.isFinite( at.y ) ? at.y : r.y ) + 0.1;
			it.ring.visible = it.fill.visible = true;
			it.ring.position.set( at.x, y, at.z );
			it.fill.position.set( at.x, y - 0.02, at.z );
			it.ring.scale.set( s, 1, s );
			const f = Math.max( 0.05, k * s );
			it.fill.scale.set( f, 1, f );
			it.ringMat.opacity = cue > 0 ? 0.95 : 0.55 + 0.45 * flash;
			it.fillMat.opacity = 0.2 + 0.35 * k;

		}

	}

	dispose() {

		if ( this.scene ) this.scene.remove( this.group );
		for ( const it of this.items.values() ) {

			it.ringMat.dispose && it.ringMat.dispose();
			it.fillMat.dispose && it.fillMat.dispose();

		}

		this.items.clear();
		this.ringGeo.dispose && this.ringGeo.dispose();
		this.fillGeo.dispose && this.fillGeo.dispose();

	}

}
