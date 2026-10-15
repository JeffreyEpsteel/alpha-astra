import { Group, Mesh, Vector3, Matrix4 } from '../../engine/index.js';
import { mat4, box, cylinder, sphere } from '../boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';
import { PIER } from '../Pier.js';
import { Kit, PALETTE as P, addRoof, addFish, fishParts, triangles, paint, lin } from './Shapes.js';
import { landingMaterial } from './Landing.js';

// Dress-over of the Tidewater landmarks you see from the new start, without touching Village.js / Pier.js:
//   - the pier's entrance arch (Tidewater's key-art gateway) gets a small jade tiled roof on its beam;
//   - two tall coral nobori banners with jade fish stand on the sand either side of the pier steps;
//   - the three stilt fishing huts by the pier foot fly swallow-tail pennants from their ridges.
//
//   const d = new Dressover( { scene, terrain, colliders, village } );   d.group, d.stats(), d.dispose()
//
// Positions come from the built village (village.pierInfo.signPivot, village.buildings), so the dressing follows
// the pier and the huts if they move. Spots for the banners are checked against the existing colliders.

export class Dressover {

	constructor( { scene = null, terrain, colliders = null, village = null } ) {

		this.group = new Group();
		this.group.name = 'StartDressover';
		this._cyls = [];
		this.colliders = colliders;
		this.parts = [];
		const kit = new Kit();
		const g = ( x, z ) => terrain.heightAt( x, z );
		const info = village && village.pierInfo;

		// ---- the pier arch: a jade roof cap sitting on the beam
		if ( info && info.signPivot ) {

			const X = info.signPivot.x, az = info.signPivot.z - 0.02, by = info.signPivot.y + 0.12;
			const half = ( PIER.width + 1.35 ) / 2;
			addRoof( kit, mat4( X, 0, az ), { hx: half + 0.3, hz: 0.5, y0: by + 0.27, h: 0.62, ridge: 0.55, lift: 0.28, tile: 0.26, rings: 6 } );
			// a lacquered board under the cap with a jade fish riding on top of the ridge
			kit.add( 'solid', box( 2 * half, 0.06, 0.34 ), { color: P.lacquer, rough: 0.5, matrix: mat4( X, by + 0.26, az ) } );
			addFish( kit, new Matrix4().multiplyMatrices( mat4( X - 0.45, by + 0.27 + 0.62 + 0.16, az ), mat4( 0, 0, 0, 0, 0, - Math.PI / 2 ) ), 0.9, 0.16, { bend: 0.7, plane: 'z', color: P.jadeLight, fin: P.jade, width: 0.5 } );
			this.parts.push( 'arch' );

			// ---- nobori banners beside the steps, on the sand (landward of the arch)
			const z0 = info.stepFoot ? info.stepFoot.z + 0.6 : az - 1.6;
			for ( const s of [ - 1, 1 ] ) {

				let x = X + s * 2.4, z = z0;
				for ( let k = 0; k < 6 && this._blocked( x, g( x, z ), z ); k ++ ) x += s * 0.5;
				if ( this._blocked( x, g( x, z ), z ) ) continue;
				this._nobori( kit, x, g( x, z ), z, s );
				this.parts.push( 'banner' );

			}

		}

		// ---- swallow-tail pennants on the stilt huts' ridges
		const huts = village && village.buildings ? village.buildings.filter( ( b ) => b.stilts && b.roofTop ) : [];
		huts.forEach( ( b, i ) => {

			const y0 = b.roofTop - 0.25;
			kit.add( 'solid', cylinder( 0.025, 0.035, 1.6, 6 ), { color: P.timberDark, rough: 0.8, matrix: mat4( b.x, y0 + 0.8, b.z ) } );
			kit.add( 'solid', sphere( 0.05, 8, 6 ), { color: P.gold, rough: 0.35, metal: 0.6, matrix: mat4( b.x, y0 + 1.62, b.z ) } );
			this._pennant( kit, new Vector3( b.x, y0 + 1.55, b.z ), [ P.coral, P.jade, P.cream ][ i % 3 ] );
			this.parts.push( 'pennant' );

		} );

		this.material = landingMaterial( 'startDressover' );
		this.clothMaterial = landingMaterial( 'startDressoverCloth', true );
		for ( const [ bucket, mat ] of [ [ 'solid', this.material ], [ 'cloth', this.clothMaterial ] ] ) {

			const geo = kit.merged( bucket );
			if ( ! geo ) continue;
			const mesh = new Mesh( geo, mat );
			mesh.name = 'StartDressover_' + bucket;
			mesh.castShadow = true;
			this.group.add( mesh );

		}

		this.triangles = kit.triangles;
		if ( scene ) scene.add( this.group );

	}

	_blocked( x, y, z ) {

		const c = this.colliders;
		if ( ! c ) return false;
		const p = new Vector3( x, y, z );
		return c.resolveCapsule( p, 0.5, 1.8 ) || c.groundHeightAt( x, z, y + 3, 0.4 ) > y + 0.3;

	}

	// a tall pole with an L arm and a long banner hanging from it (cloth; a jade fish on both faces)
	_nobori( kit, x, y, z, s ) {

		const H = 5.2, w = 0.62, hgt = 2.7;
		kit.add( 'solid', cylinder( 0.05, 0.065, H, 8 ), { color: P.lacquer, rough: 0.45, matrix: mat4( x, y + H / 2 - 0.3, z ) } );
		kit.add( 'solid', sphere( 0.08, 8, 6 ), { color: P.gold, rough: 0.35, metal: 0.6, matrix: mat4( x, y + H - 0.25, z ) } );
		// the arm points toward the steps, so the cloth hangs facing along the pier
		const ax = x - s * ( w + 0.08 ), top = y + H - 0.45;
		kit.add( 'solid', box( w + 0.1, 0.04, 0.04 ), { color: P.timberDark, rough: 0.7, matrix: mat4( ( x + ax ) / 2, top, z ) } );
		const x0 = Math.min( x, ax ) + 0.04, x1 = Math.max( x, ax ) - 0.02;
		// the cloth: a 2 x 12 grid so it bends in the wind and carries its cream hems
		const tris = [], rows = 12;
		const P0 = ( i, j ) => new Vector3( x0 + ( x1 - x0 ) * i / 2, top - 0.03 - ( hgt - 0.03 ) * j / rows, z );
		for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < 2; i ++ ) {

			tris.push( [ P0( i, j ), P0( i, j + 1 ), P0( i + 1, j ) ], [ P0( i + 1, j ), P0( i, j + 1 ), P0( i + 1, j + 1 ) ] );

		}

		const cloth = triangles( tris, ( q ) => Math.min( 1, ( top - q.y ) / hgt ) * 0.7 );
		const w8 = cloth.userData.weights, col = lin( P.coral ), hem = lin( P.cream );
		paint( cloth, ( q, k ) => [ q.y < top - hgt + 0.25 || q.y > top - 0.25 ? hem : col, [ 0.9, 0, PAT.cloth, w8[ k ] ] ] );
		kit.add( 'cloth', cloth );
		// the fish, nose up, thin enough to sit through the cloth; it sways with the cloth (same weight by height)
		const m = mat4( ( x0 + x1 ) / 2, top - hgt * 0.86, z, 0, Math.PI / 2, 0 );
		for ( const { geo, role } of fishParts( 1.6, 0.21, { bend: 0.5, plane: 'z', width: 0.09, segs: 10 } ) ) {

			geo.applyMatrix4( m );
			const fc = lin( role === 'body' ? P.jade : role === 'fin' ? P.jadeLight : role === 'eye' ? P.gold : P.ink );
			paint( geo, ( q ) => [ fc, [ 0.6, 0, PAT.plain, Math.min( 1, ( top - q.y ) / hgt ) * 0.7 ] ] );
			kit.add( 'cloth', geo );

		}

		this._cyl( x, z, 0.08, y - 0.3, y + H, 'nobori' );

	}

	// a swallow-tail pennant flying downwind from a pole top
	_pennant( kit, a, color ) {

		const L = 1.1, h = 0.42;
		const c = lin( color ), w = ( q ) => Math.min( 1, Math.hypot( q.x - a.x, q.z - a.z ) / L );
		const top = a.clone(), bot = a.clone().add( new Vector3( 0, - h, 0 ) );
		const tipT = a.clone().add( new Vector3( L, - 0.04, 0.0 ) ), tipB = a.clone().add( new Vector3( L, - h + 0.04, 0 ) );
		const notch = a.clone().add( new Vector3( L * 0.72, - h / 2, 0 ) );
		const g = triangles( [ [ top, bot, notch ], [ top, notch, tipT ], [ bot, tipB, notch ] ], w );
		const w8 = g.userData.weights;
		paint( g, ( q, k ) => [ c, [ 0.9, 0, PAT.cloth, 0.3 + 0.7 * w8[ k ] ] ] );
		kit.add( 'cloth', g );

	}

	_cyl( x, z, r, y0, y1, tag ) {

		if ( this.colliders ) this._cyls.push( this.colliders.addCylinder( x, z, r, y0, y1, { tag } ) );

	}

	stats() {

		return { triangles: this.triangles, parts: this.parts.length, colliders: this._cyls.length };

	}

	dispose() {

		if ( this.group.parent ) this.group.parent.remove( this.group );
		if ( this.colliders ) this.colliders.cylinders = this.colliders.cylinders.filter( ( c ) => ! this._cyls.includes( c ) );
		for ( const m of this.group.children ) if ( m.geometry && m.geometry.dispose ) m.geometry.dispose();
		this._cyls = [];

	}

}
