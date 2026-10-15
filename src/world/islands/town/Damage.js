import { Mesh } from '../../../engine/index.js';
import { prepare, mergePrepared, box } from '../../boat/GeoKit.js';
import { frameAt } from '../IslandKit.js';

// Tidemark's buildings under fire: they never collapse, they take a damage state. Hits (a cannonball, an explosion, a
// ramming boat or a crashing plane) near a shell add damage; past CRACK the front shows cracks and scorch marks (a
// small decal mesh made on demand), past SMOKE the roof smokes for SMOKE_HOURS of game time (through the vfx feature),
// then it is mended back to cracked. Plain state the save can carry: { id: damage }.
//
//   const dmg = new TownDamage( shells.list, { group, material } )
//   dmg.hit( x, y, z, energy ) -> building id | null     dmg.state( id ) -> 'ok' | 'cracked' | 'smoking'
//   dmg.update( dt, vfx? )   (puffs smoke on smoking roofs: vfx.smoke( x, y, z, strength, 0, 1, 0 ) when the feature is there)
//   dmg.toJSON() / fromJSON( d ) / reset()

export const CRACK = 1500; // J of damage before the walls crack
export const SMOKE = 6000; // ... before the roof smokes
export const SMOKE_SECONDS = 240; // how long a roof smokes (real seconds; it then settles to cracked)
const REACH = 2.5; // m outside a shell that still counts as a hit on it

export class TownDamage {

	constructor( list, { group = null, material = null, terrain = null } = {} ) {

		this.list = list.filter( ( b ) => b.kind !== 'lookout' );
		this.group = group;
		this.material = material;
		this.terrain = terrain;
		this.damage = {};
		this.smokeT = {};
		this.decals = {};
		this._puff = 0;

	}

	// the building whose footprint (plus REACH) holds ( x, z ) below its roof top
	at( x, y, z ) {

		for ( const b of this.list ) {

			const c = Math.cos( b.yaw ), s = Math.sin( b.yaw );
			const dx = x - b.x, dz = z - b.z;
			const lx = dx * c - dz * s, lz = dx * s + dz * c;
			if ( Math.abs( lx ) <= b.w / 2 + REACH && Math.abs( lz ) <= b.d / 2 + REACH && y <= b.top + REACH && y >= b.floorY - 1 ) return b;

		}

		return null;

	}

	hit( x, y, z, energy ) {

		const b = this.at( x, y, z );
		if ( ! b || ! ( energy > 0 ) ) return null;
		const before = this.state( b.id );
		this.damage[ b.id ] = ( this.damage[ b.id ] || 0 ) + energy;
		if ( this.damage[ b.id ] >= SMOKE ) this.smokeT[ b.id ] = SMOKE_SECONDS;
		if ( before === 'ok' && this.state( b.id ) !== 'ok' ) this._decal( b );
		return b.id;

	}

	state( id ) {

		const d = this.damage[ id ] || 0;
		if ( this.smokeT[ id ] > 0 ) return 'smoking';
		return d >= CRACK ? 'cracked' : 'ok';

	}

	update( dt, vfx = null ) {

		this._puff -= dt;
		const puff = this._puff <= 0;
		if ( puff ) this._puff = 0.6;
		for ( const id in this.smokeT ) {

			if ( ! ( this.smokeT[ id ] > 0 ) ) continue;
			this.smokeT[ id ] -= dt;
			if ( this.smokeT[ id ] <= 0 ) {

				delete this.smokeT[ id ];
				this.damage[ id ] = Math.min( this.damage[ id ] || 0, SMOKE - 1 );
				continue;

			}

			const b = this.list.find( ( q ) => q.id === id );
			if ( puff && b && vfx && typeof vfx.smoke === 'function' ) {

				try { vfx.smoke( b.x, b.top - 0.5, b.z, 0.6, 0, 1, 0 ); } catch ( e ) { /* cosmetic */ }

			}

		}

	}

	// cracks and soot on the front wall (dark jagged strips), made the first time a shell cracks
	_decal( b ) {

		if ( ! this.group || ! this.material || this.decals[ b.id ] ) return;
		const P = [];
		const F = frameAt( b.x, b.floorY, b.z, b.yaw );
		let s = 0;
		for ( let k = 0; k < b.id.length; k ++ ) s = ( s * 31 + b.id.charCodeAt( k ) ) >>> 0;
		const rnd = () => ( ( s = ( s * 16807 + 1 ) % 2147483647 ) / 2147483647 );
		for ( let k = 0; k < 7; k ++ ) {

			const lx = ( rnd() - 0.5 ) * b.w * 0.8, ly = 0.8 + rnd() * 2.6;
			P.push( prepare( box( 0.05 + rnd() * 0.05, 0.6 + rnd() * 1.2, 0.02 ), { color: 0x1d1a17, rough: 1, matrix: F.m( lx, ly, b.d / 2 + 0.13, 0, 0, ( rnd() - 0.5 ) * 1.2 ) } ) );

		}

		P.push( prepare( box( b.w * 0.5, 1.4, 0.015 ), { color: 0x2a2622, rough: 1, matrix: F.m( ( rnd() - 0.5 ) * b.w * 0.3, 2.6, b.d / 2 + 0.12 ) } ) );
		const m = new Mesh( mergePrepared( P ), this.material );
		m.name = 'tidemarkDamage_' + b.id;
		m.castShadow = false;
		this.group.add( m );
		this.decals[ b.id ] = m;

	}

	toJSON() {

		const smoke = {};
		for ( const id in this.smokeT ) smoke[ id ] = Math.round( this.smokeT[ id ] );
		return { damage: { ...this.damage }, smoke };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		for ( const b of this.list ) {

			const v = d.damage && Number( d.damage[ b.id ] );
			if ( v > 0 ) this.damage[ b.id ] = v;
			const t = d.smoke && Number( d.smoke[ b.id ] );
			if ( t > 0 ) this.smokeT[ b.id ] = Math.min( SMOKE_SECONDS, t );
			if ( this.state( b.id ) !== 'ok' ) this._decal( b );

		}

	}

	reset() {

		this.damage = {};
		this.smokeT = {};
		for ( const id in this.decals ) {

			const m = this.decals[ id ];
			if ( m.parent ) m.parent.remove( m );
			if ( m.geometry && m.geometry.dispose ) m.geometry.dispose();

		}

		this.decals = {};

	}

}
