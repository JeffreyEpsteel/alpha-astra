import { Mesh, InstancedMesh, Matrix4, Quaternion, Vector3, SphereGeometry, TorusGeometry, Color } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { createPropMaterial } from '../../game/GameMaterials.js';

// What the arsenal draws (wave 18D):
//   Props      meshes of the weapons models (ModelBank) placed by key every frame: the melee weapon / throwable in the player's
//              hand, the raiders' cutlasses and blunderbusses, the bombs and bottles in flight. place( key, id, matrix | null ),
//              then end() hides every key not placed this frame. One shared prop material (one draw a mesh).
//   ArcPreview the throw's flight while a throwable is in hand: up to 32 dots along WeaponsData.arcPoints and a ring where
//              it lands (unlit, transparent, like the melee telegraph). show( points, landing ) / hide()

const _m = new Matrix4(), _q = new Quaternion(), _s = new Vector3(), _p = new Vector3();

export class Props {

	constructor( { scene = null, bank = null } = {} ) {

		this.scene = scene;
		this.bank = bank;
		this.items = new Map(); // key -> { mesh, id, seen }
		this.material = scene ? createPropMaterial( 'weapons' ) : null;
		this.frame = 0;

	}

	place( key, id, matrix ) {

		if ( ! this.scene || ! this.bank ) return null;
		let it = this.items.get( key );
		if ( ! it ) {

			const mesh = new Mesh( this.bank.geometry( id ), this.material );
			mesh.frustumCulled = false;
			mesh.castShadow = false;
			mesh.matrixAutoUpdate = false;
			mesh.visible = false;
			this.scene.add( mesh );
			it = { mesh, id: null, seen: - 1 };
			this.items.set( key, it );

		}

		if ( it.id !== id ) {

			it.id = id;
			it.mesh.geometry = this.bank.geometry( id );
			// the Blender model when it arrives (the stand-in until then)
			this.bank.load( id, ( g ) => { if ( it.id === id ) it.mesh.geometry = g; } );

		}

		it.seen = this.frame;
		it.mesh.visible = !! matrix;
		if ( matrix ) {

			it.mesh.matrix.copy( matrix );
			it.mesh.matrixWorldNeedsUpdate = true;

		}

		return it.mesh;

	}

	// a prop at a point, turned by a quaternion (projectiles)
	placeAt( key, id, x, y, z, q = null ) {

		_m.compose( _p.set( x, y, z ), q || _q.identity(), _s.set( 1, 1, 1 ) );
		return this.place( key, id, _m );

	}

	end() {

		for ( const [ key, it ] of this.items ) {

			if ( it.seen === this.frame ) continue;
			it.mesh.visible = false;
			// a raider or a projectile that is gone for good: its mesh goes after a while
			if ( this.frame - it.seen > 600 ) {

				if ( this.scene ) this.scene.remove( it.mesh );
				this.items.delete( key );

			}

		}

		this.frame ++;

	}

	visible( key ) {

		const it = this.items.get( key );
		return !! ( it && it.mesh.visible );

	}

	dispose() {

		for ( const it of this.items.values() ) if ( this.scene ) this.scene.remove( it.mesh );
		this.items.clear();
		try { if ( this.material && this.material.dispose ) this.material.dispose(); } catch ( e ) { /* gone */ }

	}

}

const DOTS = 32;

export class ArcPreview {

	constructor( { scene = null } = {} ) {

		this.scene = scene;
		this.shown = false;
		this.points = 0;
		if ( ! scene ) return;
		this.dotMat = new Material( { name: 'throw-arc', lit: false, transparent: true, depthWrite: false, velocityWeight: 0, color: [ 1, 0.92, 0.7 ], emissive: [ 0.6, 0.5, 0.3 ], opacity: 0.75 } );
		this.ringMat = new Material( { name: 'throw-ring', lit: false, transparent: true, depthWrite: false, side: 'double', velocityWeight: 0, color: [ 1, 0.85, 0.4 ], emissive: [ 0.5, 0.35, 0.1 ], opacity: 0.8 } );
		this.dots = new InstancedMesh( new SphereGeometry( 0.035, 6, 4 ), this.dotMat, DOTS );
		this.dots.count = 0;
		this.dots.frustumCulled = false;
		this.dots.castShadow = false;
		this.dots.setColorAt( 0, new Color( 1, 1, 1 ) );
		const ringGeo = new TorusGeometry( 1, 0.05, 4, 32 );
		ringGeo.rotateX( Math.PI / 2 );
		this.ring = new Mesh( ringGeo, this.ringMat );
		this.ring.frustumCulled = false;
		this.ring.castShadow = false;
		this.ring.visible = false;
		this.dots.visible = false;
		for ( const m of [ this.dots, this.ring ] ) {

			if ( m.layers && m.layers.set ) m.layers.set( LAYERS.TRANSPARENT );
			m.renderOrder = 3;
			scene.add( m );

		}

	}

	// points: [ { x, y, z } ] (WeaponsData.arcPoints); every other point is a dot; radius: the landing ring (the blast's reach)
	show( points, radius = 0.6 ) {

		this.shown = true;
		this.points = points.length;
		if ( ! this.dots ) return;
		const n = Math.min( DOTS, Math.ceil( points.length / 2 ) ), e = this.dots.instanceMatrix.array;
		for ( let i = 0; i < n; i ++ ) {

			const p = points[ Math.min( points.length - 1, i * 2 ) ];
			_m.compose( _p.set( p.x, p.y, p.z ), _q.identity(), _s.set( 1, 1, 1 ) );
			e.set( _m.elements, i * 16 );

		}

		this.dots.count = n;
		this.dots.visible = n > 0;
		this.dots.instanceMatrix.needsUpdate = true;
		const last = points[ points.length - 1 ];
		this.ring.visible = !! ( last && last.hit );
		if ( this.ring.visible ) {

			this.ring.position.set( last.x, last.y + 0.05, last.z );
			this.ring.scale.set( radius, 1, radius );

		}

	}

	hide() {

		this.shown = false;
		this.points = 0;
		if ( ! this.dots ) return;
		this.dots.visible = false;
		this.ring.visible = false;

	}

	dispose() {

		if ( ! this.dots ) return;
		for ( const m of [ this.dots, this.ring ] ) if ( this.scene ) this.scene.remove( m );
		this.dotMat.dispose && this.dotMat.dispose();
		this.ringMat.dispose && this.ringMat.dispose();

	}

}
