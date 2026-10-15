import { Mesh, Group, SphereGeometry } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { THROW } from './MeleeData.js';

// The thrower's rocks (wave 12E): a few ballistic stones in flight at once. Pure flight maths plus an optional mesh each;
// the owner (Melee) resolves what a rock meets:
//
//   const rocks = new Rocks( { scene } );                 // scene null: headless (the tests)
//   rocks.launch( from: { x, y, z }, at: { x, y, z }, src )   src: the thrower (cfg.damage, name, kind, practiceFight)
//   rocks.update( dt, { player: { x, y, z } | null, ground: ( x, z ) -> y, hit( rock ) -> bool } )
//      hit( rock ) is called once when a rock reaches the player's body (THROW.radius); it returns true when the rock is
//      spent there (blocked, dodged through, landed). A rock that reaches the ground first just stops (the owner's land( rock )).
//   rocks.list (live rocks: { x, y, z, vx, vy, vz, src, t }), rocks.clear(), rocks.dispose()
//
// The flight: launched from the hand at THROW.speed over the ground with the vertical speed that brings it to the aim
// point's chest height in the same time, under THROW.gravity: a short readable arc, no lead.

const MAX = 6;
const CHEST = 1.15; // m above the aim point the rock is aimed at

export class Rocks {

	constructor( { scene = null } = {} ) {

		this.scene = scene;
		this.list = [];
		this.thrown = 0;
		this._pool = [];
		this.group = null;
		if ( scene ) {

			try {

				this.group = new Group();
				this.group.name = 'MeleeRocks';
				this.geo = new SphereGeometry( 0.11, 8, 6 );
				this.mat = new Material( { name: 'thrown-rock', color: [ 0.42, 0.4, 0.37 ], roughness: 0.95 } );
				scene.add( this.group );

			} catch ( e ) {

				this.group = null;

			}

		}

	}

	launch( from, at, src ) {

		while ( this.list.length >= MAX ) this._free( this.list.shift() );
		const dx = at.x - from.x, dz = at.z - from.z, flat = Math.hypot( dx, dz );
		const T = Math.max( 0.25, flat / THROW.speed );
		const ty = ( at.y || 0 ) + CHEST;
		const rock = {
			x: from.x, y: from.y, z: from.z,
			vx: dx / T, vz: dz / T, vy: ( ty - from.y ) / T + 0.5 * THROW.gravity * T,
			src, t: 0, flight: T, done: false, mesh: this._mesh(),
		};
		this.list.push( rock );
		this.thrown ++;
		this._place( rock );
		return rock;

	}

	update( dt, env = {} ) {

		const pl = env.player;
		for ( let i = this.list.length - 1; i >= 0; i -- ) {

			const r = this.list[ i ];
			const px = r.x, py = r.y, pz = r.z;
			r.t += dt;
			r.vy -= THROW.gravity * dt;
			r.x += r.vx * dt;
			r.y += r.vy * dt;
			r.z += r.vz * dt;
			// the player's body: a capsule 1.9 m tall; tested along the step so a fast rock cannot skip through
			if ( pl && ! r.done ) {

				const ex = r.x - px, ez = r.z - pz, el = ex * ex + ez * ez;
				let k = el > 1e-9 ? ( ( pl.x - px ) * ex + ( pl.z - pz ) * ez ) / el : 1;
				k = k < 0 ? 0 : k > 1 ? 1 : k;
				const cx = px + ex * k, cz = pz + ez * k, cy = py + ( r.y - py ) * k;
				if ( Math.hypot( cx - pl.x, cz - pl.z ) <= THROW.radius && cy >= pl.y - 0.1 && cy <= pl.y + 1.95 ) {

					r.x = cx; r.y = cy; r.z = cz;
					if ( env.hit && env.hit( r ) ) r.done = true;

				}

			}

			const g = env.ground ? env.ground( r.x, r.z ) : 0;
			if ( ! r.done && ( r.y <= ( Number.isFinite( g ) ? g : 0 ) || r.t > r.flight + 2 ) ) {

				r.done = true;
				if ( env.land ) env.land( r );

			}

			if ( r.done ) {

				this.list.splice( i, 1 );
				this._free( r );
				continue;

			}

			this._place( r );

		}

	}

	_mesh() {

		if ( ! this.group ) return null;
		let m = this._pool.pop();
		if ( ! m ) {

			m = new Mesh( this.geo, this.mat );
			m.castShadow = true;
			m.frustumCulled = false;
			this.group.add( m );

		}

		m.visible = true;
		return m;

	}

	_place( r ) {

		if ( r.mesh ) {

			r.mesh.position.set( r.x, r.y, r.z );
			r.mesh.rotation.set( r.t * 9, r.t * 5, 0 );
			if ( typeof r.mesh.updateMatrixWorld === 'function' ) r.mesh.updateMatrixWorld( true );

		}

	}

	_free( r ) {

		if ( r && r.mesh ) {

			r.mesh.visible = false;
			this._pool.push( r.mesh );
			r.mesh = null;

		}

	}

	clear() {

		for ( const r of this.list ) this._free( r );
		this.list.length = 0;

	}

	dispose() {

		this.clear();
		if ( this.group && this.scene ) this.scene.remove( this.group );
		if ( this.geo && this.geo.dispose ) this.geo.dispose();
		if ( this.mat && this.mat.dispose ) this.mat.dispose();
		this.group = null;

	}

}
