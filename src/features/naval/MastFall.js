// A mast shot through (wave 11A): it breaks at the deck, topples over the side, splashes, floats a while and sinks - the
// pattern of the seaplane's shed parts (seaplane/Wreck.js + PlaneVisual.detach), for one spar.
//
//   const fall = new MastFall( { height, side } )   side +1 falls to port (+X), -1 to starboard
//   fall.update( dt ) -> events [ { type: 'crack' } (the first step) | { type: 'splash' } (it hit the water) | { type: 'gone' } ]
//   fall.angle (rad from upright)  fall.roll (about the boat's Z: -side * angle)  fall.phase 'falling' | 'afloat' | 'sinking' | 'gone'
//   fall.depth (m it has sunk)     fall.tip( out ) the tip in the boat frame from the foot (for the splash)
//
//   const vis = MastVisual.from( root, scene, { foot: { x, y, z } boat frame, match } )   or null when nothing matches
//       root: the hull's group (ShipVisual.group, app.boat.group); match( mesh ) -> bool picks the spars, sails and rigging
//       (MAST_MESH by default). The originals are hidden; clones sharing their geometry and materials topple on a hinge at
//       the foot under the root (they ride the hull while falling), then go to the scene where they lie in the water.
//   vis.update( fall, dt )   vis.dispose()   vis.restore() (the yard re-rigs her: the originals come back)
//   hideMast( root, match? ) -> [ meshes hidden ]   a hull already dismasted (a save, a model that loaded late)

import { Group, Mesh, Vector3, Quaternion, Matrix4 } from '../../engine/index.js';

export const MAST_FALL = { kick: 0.05, max: 1.62, afloat: 8, sinkTime: 12, sinkDepth: 6, g: 9.81 };
export const MAST_MESH = /spar|sail|canvas|rigging|mast/i;

export class MastFall {

	constructor( { height = 10, side = 1 } = {} ) {

		this.height = Math.max( 2, height );
		this.side = side >= 0 ? 1 : - 1;
		this.angle = MAST_FALL.kick;
		this.omega = 0;
		this.phase = 'falling';
		this.t = 0;
		this.depth = 0;
		this._cracked = false;

	}

	get roll() {

		return - this.side * this.angle;

	}

	tip( out = {} ) {

		out.x = this.side * Math.sin( this.angle ) * this.height;
		out.y = Math.cos( this.angle ) * this.height;
		out.z = 0;
		return out;

	}

	update( dt ) {

		const ev = [];
		if ( this.phase === 'gone' || ! ( dt > 0 ) ) return ev;
		if ( ! this._cracked ) {

			this._cracked = true;
			ev.push( { type: 'crack' } );

		}

		this.t += dt;
		if ( this.phase === 'falling' ) {

			// a rod pivoting on its foot: theta'' = 3 g / ( 2 h ) sin theta
			this.omega += 1.5 * MAST_FALL.g / this.height * Math.sin( this.angle ) * dt;
			this.angle += this.omega * dt;
			if ( this.angle >= MAST_FALL.max ) {

				this.angle = MAST_FALL.max;
				this.omega = 0;
				this.phase = 'afloat';
				this.t = 0;
				ev.push( { type: 'splash' } );

			}

		} else if ( this.phase === 'afloat' ) {

			if ( this.t >= MAST_FALL.afloat ) {

				this.phase = 'sinking';
				this.t = 0;

			}

		} else if ( this.phase === 'sinking' ) {

			const k = Math.min( 1, this.t / MAST_FALL.sinkTime );
			this.depth = Math.pow( k, 1.6 ) * MAST_FALL.sinkDepth;
			if ( k >= 1 ) {

				this.phase = 'gone';
				ev.push( { type: 'gone' } );

			}

		}

		return ev;

	}

}

// a hull whose mast is already down (a save, a model that loaded late): hide the spars without the fall. Returns them.
export function hideMast( root, match = ( m ) => MAST_MESH.test( m.name || '' ) ) {

	const out = [];
	if ( ! root || typeof root.traverse !== 'function' ) return out;
	root.traverse( ( o ) => {

		if ( o.isMesh && o.visible !== false && match( o ) && ! /-fallen$/.test( o.name || '' ) ) {

			o.visible = false;
			out.push( o );

		}

	} );
	return out;

}

const _m = new Matrix4(), _inv = new Matrix4(), _p = new Vector3(), _q = new Quaternion(), _s = new Vector3();

export class MastVisual {

	// the meshes under `root` that `match`; null when there are none (a model still loading)
	static from( root, scene, { foot = { x: 0, y: 2, z: 0 }, match = ( m ) => MAST_MESH.test( m.name || '' ) } = {} ) {

		if ( ! root || typeof root.traverse !== 'function' ) return null;
		const found = [];
		root.traverse( ( o ) => { if ( o.isMesh && o.visible !== false && match( o ) ) found.push( o ); } );
		return found.length ? new MastVisual( root, scene, foot, found ) : null;

	}

	constructor( root, scene, foot, meshes ) {

		this.root = root;
		this.scene = scene;
		this.originals = meshes;
		this.hinge = new Group();
		this.hinge.name = 'mast-fall';
		this.hinge.position.set( foot.x, foot.y, foot.z );
		const off = new Group();
		off.position.set( - foot.x, - foot.y, - foot.z );
		this.hinge.add( off );
		// each clone where its original sits relative to the root
		root.updateMatrixWorld( true );
		_inv.copy( root.matrixWorld ).invert();
		for ( const m of meshes ) {

			const c = new Mesh( m.geometry, m.material );
			c.name = m.name + '-fallen';
			c.castShadow = m.castShadow;
			c.receiveShadow = m.receiveShadow;
			_m.multiplyMatrices( _inv, m.matrixWorld ).decompose( _p, _q, _s );
			c.position.copy( _p );
			c.quaternion.copy( _q );
			c.scale.copy( _s );
			off.add( c );
			m.visible = false;

		}

		root.add( this.hinge );
		this.free = false;
		this.baseY = 0;

	}

	update( fall, dt = 0 ) {

		if ( ! this.hinge ) return;
		if ( fall.phase === 'gone' ) {

			this.dispose();
			return;

		}

		if ( ! this.free ) {

			this.hinge.rotation.set( 0, 0, fall.roll );
			if ( fall.phase !== 'falling' && this.scene && typeof this.scene.attach === 'function' ) {

				// over the side: it no longer rides the hull
				this.scene.attach( this.hinge );
				this.free = true;
				this.baseY = this.hinge.position.y;

			}

			return;

		}

		this.hinge.position.y = this.baseY - fall.depth;
		this.hinge.position.x += 0.15 * dt; // a slow drift on the swell
		this.hinge.updateMatrixWorld( true );

	}

	dispose() {

		if ( ! this.hinge ) return;
		this.hinge.removeFromParent();
		this.hinge = null; // (the geometry and materials are the hull's: not ours to dispose)

	}

	restore() {

		this.dispose();
		for ( const m of this.originals ) m.visible = true;

	}

}
