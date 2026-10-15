// Floating loot crates dropped by a sinking ship. They drift apart, bob on the swell and are collected by
// driving over them (the player's boat centre within `reach` metres) or swimming into them; they sink after
// LOOT_LIFE seconds.
//
//   const loot = new Loot( { scene } );
//   loot.drop( x, z, value, source )                    one crate worth `value` coins
//   loot.update( dt, time, picker )                     picker( crate ) -> bool; called for each crate that is near the
//                                                       player (see `near`); true = collected (removed)
//   loot.near( crate, x, z, reach ) -> bool
//   loot.list                                           [ { id, x, z, y, value, source, age } ]
// A crate is a timber box with a small gold buoy flag above it (visible from far away).

import { BoxGeometry, Group, IcosahedronGeometry, Mesh } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { proceduralHeight } from './WaterPool.js';

export const LOOT_LIFE = 150;
const MAX_CRATES = 14;

export class Loot {

	constructor( { scene = null } = {} ) {

		this.scene = scene;
		this.list = [];
		this._id = 1;
		this._geo = [];
		this._mat = [];
		if ( scene ) {

			const box = new BoxGeometry( 0.95, 0.62, 0.95 );
			const gem = new IcosahedronGeometry( 0.2, 0 );
			const wood = new Material( { name: 'nv-crate', color: 0x8a5a2b, roughness: 0.85, underwaterLighting: 'lite' } );
			const gold = new Material( { name: 'nv-crate-gold', color: 0xe0b040, emissive: [ 1.2, 0.8, 0.2 ], roughness: 0.35, metalness: 0.8, underwaterLighting: 'lite' } );
			this._geo.push( box, gem );
			this._mat.push( wood, gold );
			this._make = () => {

				const g = new Group();
				const b = new Mesh( box, wood );
				b.castShadow = true;
				const f = new Mesh( gem, gold );
				f.position.y = 1.5;
				g.add( b, f );
				g.userData.flag = f;
				scene.add( g );
				return g;

			};

		}

	}

	drop( x, z, value, source = '' ) {

		if ( this.list.length >= MAX_CRATES ) this._remove( 0 );
		const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 1.6;
		const c = { id: this._id ++, x, z, y: 0, vx: Math.cos( a ) * s, vz: Math.sin( a ) * s, value, source, age: 0, phase: Math.random() * 6, mesh: this._make ? this._make() : null };
		this.list.push( c );
		return c;

	}

	_remove( i ) {

		const [ c ] = this.list.splice( i, 1 );
		if ( c && c.mesh && this.scene ) this.scene.remove( c.mesh );

	}

	near( c, x, z, reach ) {

		return Math.hypot( c.x - x, c.z - z ) <= reach;

	}

	update( dt, time, picker = null ) {

		for ( let i = this.list.length - 1; i >= 0; i -- ) {

			const c = this.list[ i ];
			c.age += dt;
			c.x += c.vx * dt;
			c.z += c.vz * dt;
			const damp = Math.exp( - dt * 0.9 );
			c.vx *= damp;
			c.vz *= damp;
			c.y = proceduralHeight( c.x, c.z, time ) * 0.9;
			if ( picker && picker( c ) ) {

				this._remove( i );
				continue;

			}

			if ( c.age > LOOT_LIFE ) {

				this._remove( i );
				continue;

			}

			const m = c.mesh;
			if ( m ) {

				const sink = c.age > LOOT_LIFE - 6 ? ( c.age - ( LOOT_LIFE - 6 ) ) / 6 * 1.2 : 0;
				m.position.set( c.x, c.y + 0.12 - sink, c.z );
				m.rotation.set( Math.sin( time * 1.3 + c.phase ) * 0.1, c.phase + time * 0.1, Math.sin( time * 0.9 + c.phase ) * 0.12 );
				m.userData.flag.rotation.y = time * 1.6;
				m.userData.flag.position.y = 1.5 + Math.sin( time * 2 + c.phase ) * 0.12;

			}

		}

	}

	clear() {

		while ( this.list.length ) this._remove( 0 );

	}

	dispose() {

		this.clear();
		for ( const g of this._geo ) g.dispose && g.dispose();
		for ( const m of this._mat ) m.dispose && m.dispose();

	}

}
