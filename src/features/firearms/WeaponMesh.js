import { Mesh, Matrix4, Vector3, Quaternion } from '../../engine/index.js';
import { triangleCount, prepare, cylinder } from '../../world/boat/GeoKit.js';
import { createPropMaterial } from '../../game/GameMaterials.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { ORDER } from './FirearmsData.js';
import { ModelBank, buildGeometry, MUZZLES, MATS } from '../weapons/WeaponModels.js';

// The gun in the hand: every firearm (FirearmsData ORDER) in the game's prop material (GameMaterials createPropMaterial: colour +
// aux = roughness / metalness / pattern). Wave 9B built the pistol and the musket from GeoKit primitives; wave 18D moved the
// geometry to weapons/WeaponModels.js: a procedural stand-in at once (each well under 600 triangles), then the Blender model
// (public/models/weapons/<id>.glb, <= 2.5k triangles) once it has loaded. Held like the fishing rod: the game hands us the
// avatar's right-hand prop socket (Avatar.handMatrix, the rig's weapon_r; FishingRod.anchor) and the gun hangs off it with
// its grip in the palm, the barrel along the socket's +Z (the rod's shaft) and its lock side up the socket's -Y (the rod's
// reel hangs toward +Y, below the blank). Without an avatar it sits off the camera, first-person style.
//
//   const w = new WeaponMesh( { scene, glb } );   w.update( { kind, visible, anchor: Matrix4 | null, camera, recoil, hold, line } )
//   w.muzzle( out ) -> world position of the muzzle ( { x, y, z } )    w.dispose()
//   buildWeaponGeometry( kind ) -> BufferGeometry (the stand-in; the test counts its triangles)
//   line: the harpoon gun's line ( { x, y, z } the harpoon's end, or null): a rope from the muzzle and the bolt at its end
//
// Gun frame: origin at the grip (where the hand closes), +Z the muzzle, +Y up (the lock and the hammer on top, +X its right side).
// HOLD tunes the pose in the hand (pitch about the gun's X, rad: the Fishing_Hold overlay carries the rod raised, so the gun is
// tipped down to point ahead); FP is the first-person offset in camera space.

export const HOLD = { pitch: - 0.55, x: 0, y: 0, z: 0 };
export const FP = { x: 0.16, y: - 0.17, z: - 0.42 };
export const MUZZLE = MUZZLES;

export function buildWeaponGeometry( kind = 'pistol' ) {

	return buildGeometry( kind );

}

export function weaponTriangles( kind ) {

	return triangleCount( buildWeaponGeometry( kind ) );

}

const _hold = new Matrix4(), _rot = new Matrix4(), _fp = new Matrix4(), _v = new Vector3();
const _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _hq = new Quaternion();
const _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _up = new Vector3( 0, 1, 0 );

export class WeaponMesh {

	constructor( { scene = null, glb = true, bank = null } = {} ) {

		this.scene = scene;
		this.meshes = {};
		this.matrix = new Matrix4();
		this.kind = null;
		this.valid = false;
		if ( ! scene ) return;
		this.bank = bank || new ModelBank( { loader: glb ? loadGLB : null } );
		this.material = createPropMaterial( 'firearm' );
		for ( const kind of ORDER ) {

			const m = new Mesh( this.bank.geometry( kind ), this.material );
			m.name = 'Firearm_' + kind;
			m.frustumCulled = false;
			m.castShadow = false;
			m.matrixAutoUpdate = false;
			m.visible = false;
			scene.add( m );
			this.meshes[ kind ] = m;

		}

		// the harpoon gun's line (a unit rope along +Y, stretched each frame) and the harpoon at its end
		this.rope = new Mesh( prepare( cylinder( 0.004, 0.004, 1, 4, 1 ), { ...MATS.Rope, matrix: new Matrix4().makeTranslation( 0, 0.5, 0 ) } ), this.material );
		this.bolt = new Mesh( this.bank.geometry( 'bolt' ), this.material );
		for ( const m of [ this.rope, this.bolt ] ) {

			m.frustumCulled = false;
			m.castShadow = false;
			m.matrixAutoUpdate = false;
			m.visible = false;
			scene.add( m );

		}

	}

	// the Blender model of `kind` the first time it is drawn (the stand-in shows until then)
	_want( kind ) {

		const m = this.meshes[ kind ];
		if ( ! m || m._asked || ! this.bank ) return;
		m._asked = true;
		this.bank.load( kind, ( g ) => { if ( this.meshes[ kind ] === m ) m.geometry = g; } );
		if ( kind === 'harpoongun' ) this.bank.load( 'bolt', ( g ) => { if ( this.bolt ) this.bolt.geometry = g; } );

	}

	// place the gun for this frame: in the hand (anchor) or off the camera; recoil (0..1) tips the muzzle up and back
	// hold: [ x, y, z, w ] the gun in the socket (GunPose.js: barrel ahead in that gun's aim pose), else HOLD's rod-hold pitch
	update( { kind = null, visible = false, anchor = null, camera = null, recoil = 0, hold = null, line = null } = {} ) {

		this.kind = kind;
		this.valid = false;
		const r = Math.max( 0, Math.min( 1, recoil ) );
		if ( kind && ( anchor || ( camera && camera.matrixWorld ) ) ) {

			if ( anchor ) {

				// gun +X -> socket -X, gun +Y -> socket -Y (away from the reel side), gun +Z -> socket +Z (the shaft)
				if ( hold ) {

					_hold.makeRotationFromQuaternion( _hq.set( hold[ 0 ], hold[ 1 ], hold[ 2 ], hold[ 3 ] ) );
					_rot.makeRotationX( - r * 0.35 );

				} else {

					_hold.makeBasis( _x.set( - 1, 0, 0 ), _y.set( 0, - 1, 0 ), _z.set( 0, 0, 1 ) ).setPosition( _v.set( HOLD.x, HOLD.y, HOLD.z ) );
					_rot.makeRotationX( HOLD.pitch - r * 0.35 );

				}
				this.matrix.multiplyMatrices( anchor, _hold ).multiply( _rot );

			} else {

				if ( camera.updateMatrixWorld ) camera.updateMatrixWorld();
				_fp.makeBasis( _x.set( - 1, 0, 0 ), _y.set( 0, 1, 0 ), _z.set( 0, 0, - 1 ) ).setPosition( _v.set( FP.x, FP.y, FP.z + r * 0.04 ) );
				_rot.makeRotationX( - r * 0.3 );
				this.matrix.multiplyMatrices( camera.matrixWorld, _fp ).multiply( _rot );

			}

			this.valid = true;

		}

		for ( const [ k, m ] of Object.entries( this.meshes ) ) {

			m.visible = !! ( visible && this.valid && k === kind );
			if ( m.visible ) {

				this._want( k );
				m.matrix.copy( this.matrix );
				m.matrixWorldNeedsUpdate = true;

			}

		}

		this._line( visible && this.valid && kind === 'harpoongun' ? line : null );

	}

	// the rope from the muzzle to the harpoon, the harpoon at its end pointing away from the gun
	_line( line ) {

		if ( ! this.rope ) return;
		const on = !! ( line && [ line.x, line.y, line.z ].every( Number.isFinite ) && this.muzzle( _a ) );
		this.rope.visible = this.bolt.visible = on;
		if ( ! on ) return;
		_b.set( line.x, line.y, line.z );
		_d.subVectors( _b, _a );
		const len = _d.length();
		if ( len < 0.05 ) { this.rope.visible = this.bolt.visible = false; return; }
		_d.multiplyScalar( 1 / len );
		_q.setFromUnitVectors( _up, _d );
		this.rope.matrix.compose( _a, _q, _s.set( 1, len, 1 ) );
		this.rope.matrixWorldNeedsUpdate = true;
		// the bolt's +Z along the line
		_q.setFromUnitVectors( _z.set( 0, 0, 1 ), _d );
		this.bolt.matrix.compose( _b, _q, _s.set( 1, 1, 1 ) );
		this.bolt.matrixWorldNeedsUpdate = true;

	}

	// world position of the muzzle of `kind` (the last update's placement), or null before one
	muzzle( out = {}, kind = this.kind ) {

		if ( ! this.valid || ! kind ) return null;
		const m = MUZZLE[ kind ] || MUZZLE.pistol;
		_v.set( m[ 0 ], m[ 1 ], m[ 2 ] ).applyMatrix4( this.matrix );
		out.x = _v.x; out.y = _v.y; out.z = _v.z;
		return out;

	}

	dispose() {

		for ( const m of [ ...Object.values( this.meshes ), this.rope, this.bolt ] ) {

			if ( ! m ) continue;
			if ( this.scene && this.scene.remove ) this.scene.remove( m );

		}

		try { if ( this.rope ) this.rope.geometry.dispose(); } catch ( e ) { /* gone */ }
		if ( this.bank ) this.bank.dispose();
		try { if ( this.material && this.material.dispose ) this.material.dispose(); } catch ( e ) { /* gone */ }
		this.meshes = {};
		this.rope = this.bolt = null;

	}

}
