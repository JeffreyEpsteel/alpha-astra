// Floating wreckage (wave 9): the planks a hull sheds when she goes down or is stove in by a ram. They burst out from the
// hull, settle on the water, bob on the swell and drift apart, then sink after PLANK_LIFE seconds. Decoration only (no
// pickup); headless without a scene (the list still runs for the tests).
//
//   const planks = new Planks( { scene } );
//   planks.burst( x, z, count, spread )      `count` planks thrown from around ( x, z )
//   planks.update( dt, time );  planks.list [ { x, z, y, vx, vz, yaw, age } ];  planks.clear();  planks.dispose()

import { BoxGeometry, Mesh } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { proceduralHeight } from './WaterPool.js';

export const PLANK_LIFE = 60;
const MAX_PLANKS = 40;

export class Planks {

	constructor( { scene = null } = {} ) {

		this.scene = scene;
		this.list = [];
		this._geo = null;
		this._mats = [];
		if ( scene ) {

			this._geo = new BoxGeometry( 0.28, 0.07, 1.9 );
			this._mats = [ 0x6e4a2a, 0x82592f, 0x5a3b22 ].map( ( c, i ) => new Material( { name: 'nv-plank-' + i, color: c, roughness: 0.9, underwaterLighting: 'lite' } ) );

		}

	}

	burst( x, z, count = 6, spread = 3 ) {

		for ( let i = 0; i < count; i ++ ) {

			if ( this.list.length >= MAX_PLANKS ) this._remove( 0 );
			const a = Math.random() * Math.PI * 2, r = Math.random() * spread, s = 1.5 + Math.random() * 3;
			const p = {
				x: x + Math.cos( a ) * r, z: z + Math.sin( a ) * r, y: 1.5, vy: 2 + Math.random() * 3,
				vx: Math.cos( a ) * s, vz: Math.sin( a ) * s, yaw: Math.random() * Math.PI * 2, spin: ( Math.random() - 0.5 ) * 4,
				age: 0, phase: Math.random() * 6, scale: 0.7 + Math.random() * 0.6, mesh: null,
			};
			if ( this._geo ) {

				p.mesh = new Mesh( this._geo, this._mats[ i % this._mats.length ] );
				p.mesh.scale.set( 1, 1, p.scale );
				p.mesh.castShadow = true;
				this.scene.add( p.mesh );

			}

			this.list.push( p );

		}

	}

	_remove( i ) {

		const [ p ] = this.list.splice( i, 1 );
		if ( p && p.mesh && this.scene ) this.scene.remove( p.mesh );

	}

	update( dt, time ) {

		for ( let i = this.list.length - 1; i >= 0; i -- ) {

			const p = this.list[ i ];
			p.age += dt;
			if ( p.age > PLANK_LIFE ) {

				this._remove( i );
				continue;

			}

			p.x += p.vx * dt;
			p.z += p.vz * dt;
			const water = proceduralHeight( p.x, p.z, time ) * 0.9;
			if ( p.y > water + 0.02 || p.vy > 0 ) {

				// thrown clear: a short flight back onto the water
				p.vy -= 9.81 * dt;
				p.y += p.vy * dt;
				if ( p.y <= water ) { p.y = water; p.vy = 0; }

			} else p.y = water;

			const damp = Math.exp( - dt * ( p.y > water + 0.05 ? 0.1 : 0.8 ) );
			p.vx *= damp;
			p.vz *= damp;
			p.spin *= Math.exp( - dt * 0.6 );
			p.yaw += p.spin * dt;
			const m = p.mesh;
			if ( m ) {

				const sink = p.age > PLANK_LIFE - 5 ? ( p.age - ( PLANK_LIFE - 5 ) ) / 5 * 0.6 : 0;
				m.position.set( p.x, p.y + 0.02 - sink, p.z );
				m.rotation.set( Math.sin( time * 1.4 + p.phase ) * 0.12, p.yaw, Math.sin( time * 1.1 + p.phase ) * 0.15 );

			}

		}

	}

	clear() {

		while ( this.list.length ) this._remove( 0 );

	}

	dispose() {

		this.clear();
		if ( this._geo && this._geo.dispose ) this._geo.dispose();
		for ( const m of this._mats ) m.dispose && m.dispose();

	}

}
