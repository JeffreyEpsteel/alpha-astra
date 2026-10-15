// Rider boxes (wave 15D): small walkable collider boxes tagged 'floating' that ride the things afloat near the player, so
// Player's one climb rule (CLIMB, FLOAT_TAGS) finds them from the water and the walker stands on them: the yard's display
// hulls and their mooring buoys (app.boatYard), naval's floating planks, the parked seaplane's floats, and a sunk boat lying
// in water shallow enough to show (naval.wrecks). Boxes are added near the player and taken out of the colliders again
// when nothing is near (a pool; nothing is allocated per frame once warm).
//
//   const fl = new Floaters( { app, features } );   fl.update()   fl.boxes (in the colliders now)   fl.clear()
import { Vector3 } from '../../engine/index.js';
import { BOATS } from '../../game/Boats.js';

export const NEAR = 40; // m from the player
const POOL = 10;
const _v = new Vector3();

export class Floaters {

	constructor( { app, features } ) {

		this.app = app;
		this.features = features;
		this.boxes = []; // in the colliders this frame
		this._pool = [];
		this._want = [];

	}

	get colliders() {

		return this.app && this.app.colliders && this.app.colliders.addBox ? this.app.colliders : null;

	}

	// what floats near ( px, pz ): [ { x, y (top), z, yaw, hx, hy, hz, label, minRise } ]
	gather( px, pz ) {

		const out = this._want;
		out.length = 0;
		const near = ( x, z, r = 0 ) => Math.abs( x - px ) < NEAR + r && Math.abs( z - pz ) < NEAR + r;
		const f = ( n ) => ( this.features && this.features.get ? this.features.get( n ) : null );

		// the yard's display hulls and their buoys
		const yard = this.app && this.app.boatYard;
		if ( yard && yard.boats && typeof yard.boats.values === 'function' ) {

			for ( const b of yard.boats.values() ) {

				const spec = BOATS[ b.id ];
				const g = b.group, pos = b.position;
				if ( spec && pos && near( pos.x, pos.z, spec.length ) && b.loaded !== false ) {

					out.push( { x: pos.x, y: ( pos.y || 0 ) + ( spec.deckY ?? 0.4 ), z: pos.z, yaw: b.yaw || ( g && g.rotation ? g.rotation.y : 0 ), hx: Math.max( 0.4, spec.beam / 2 - 0.3 ), hy: 0.1, hz: Math.max( 0.8, spec.length / 2 - 0.6 ), label: `Climb aboard the ${ spec.name }`, minRise: 0.1 } );

				}

				const by = b.buoy && b.buoy.position;
				if ( by && near( by.x, by.z ) ) out.push( { x: by.x, y: by.y + 0.22, z: by.z, yaw: 0, hx: 0.25, hy: 0.1, hz: 0.25, label: 'Climb onto the buoy', minRise: 0.05 } );

			}

		}

		// naval: floating planks; your sunk boat when she lies shallow enough to break the surface
		const nv = f( 'naval' );
		const planks = nv && nv.planks && nv.planks.list;
		if ( planks ) for ( const p of planks ) if ( near( p.x, p.z ) && Number.isFinite( p.y ) ) out.push( { x: p.x, y: p.y + 0.035, z: p.z, yaw: p.yaw || 0, hx: 0.3, hy: 0.04, hz: 0.95, label: 'Climb onto the plank', minRise: - 0.2 } );
		const wr = nv && nv.wrecks;
		const wrecks = [];
		if ( wr && wr.own ) wrecks.push( wr.own );
		if ( wr && wr.remote && typeof wr.remote.values === 'function' ) for ( const w of wr.remote.values() ) wrecks.push( w );
		for ( const w of wrecks ) {

			const spec = BOATS[ w.boat ] || { length: 8, beam: 2.8, deckY: 0.6, name: 'boat' };
			if ( ! Number.isFinite( w.x ) || ! Number.isFinite( w.y ) || ! near( w.x, w.z, spec.length ) ) continue;
			out.push( { x: w.x, y: w.y + ( spec.deckY ?? 0.6 ) + 0.2, z: w.z, yaw: w.yaw || 0, hx: Math.max( 0.4, spec.beam / 2 - 0.3 ), hy: 0.15, hz: Math.max( 0.8, spec.length / 2 - 0.5 ), label: 'Climb onto the wreck' } );

		}

		// the seaplane at rest on the water: its floats (the wreck's roof is the seaplane's own perch box)
		const sp = f( 'seaplane' );
		const fl = sp && sp.flight;
		if ( sp && fl && sp.owned && ! sp.lost && ! sp.piloted && ! fl.airborne && fl.position && fl.toWorldXYZ && near( fl.position.x, fl.position.z, 8 ) ) {

			const g = fl.geom || {};
			const X = g.floatX ?? 1.35, top = g.floatTop ?? 0.62, bow = g.floatBow ?? 3.5, stern = g.floatStern ?? - 3.9, beam = g.floatBeam ?? 0.8;
			const yaw = fl.heading ? fl.heading() : 0;
			for ( const s of [ 1, - 1 ] ) {

				const c = fl.toWorldXYZ( s * X, top, ( bow + stern ) / 2, _v );
				out.push( { x: c.x, y: c.y, z: c.z, yaw, hx: beam / 2, hy: 0.1, hz: ( bow - stern ) / 2, label: 'Climb onto the float', minRise: 0.1 } );

			}

		}

		return out;

	}

	update() {

		const col = this.colliders, p = this.app && this.app.player;
		if ( ! col || ! p || ! p.position ) return;
		// only for someone in or at the water: on foot inland the boxes go
		const want = p.mode === 'swim' || p.mode === 'walk' ? this.gather( p.position.x, p.position.z ) : [];
		const n = Math.min( POOL, want.length );
		for ( let i = 0; i < n; i ++ ) {

			const w = want[ i ];
			let b = this._pool[ i ];
			if ( ! b ) b = this._pool[ i ] = col.addBox( new Vector3( w.x, w.y - w.hy, w.z ), new Vector3( w.hx, w.hy, w.hz ), w.yaw, { walkable: true, solid: false, tag: 'floating' } );
			else if ( ! b._rescueIn ) col.boxes.push( b );
			b._rescueIn = true;
			b.center.set( w.x, w.y - w.hy, w.z );
			b.half.set( w.hx, w.hy, w.hz );
			b.rotY = w.yaw;
			b.cos = Math.cos( w.yaw );
			b.sin = Math.sin( w.yaw );
			b.top = w.y;
			b.bottom = w.y - 2 * w.hy;
			b.radius = Math.hypot( w.hx, w.hz );
			b.label = w.label;
			b.minRise = w.minRise;

		}

		for ( let i = n; i < this._pool.length; i ++ ) this._drop( this._pool[ i ] );
		this.boxes.length = 0;
		for ( let i = 0; i < n; i ++ ) this.boxes.push( this._pool[ i ] );

	}

	_drop( b ) {

		const col = this.colliders;
		if ( ! b || ! col ) return;
		if ( ! b._rescueIn ) return;
		b._rescueIn = false;
		const i = col.boxes.indexOf( b );
		if ( i >= 0 ) col.boxes.splice( i, 1 );

	}

	clear() {

		for ( const b of this._pool ) this._drop( b );
		this.boxes.length = 0;

	}

}
