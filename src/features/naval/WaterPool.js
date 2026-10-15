// Heave, pitch and roll of the ships from the water surface.
//
// The app's WaterQuery (src/ocean/WaterQuery.js) has 64 GPU slots shared with the boat, the swimmer, the bobber,
// the whale and the wildlife, and answers 1-3 frames late. A WaterPool takes a few of them (`ships` x 4 points)
// and hands them to the ships nearest the camera: each frame queue( ship ) writes the bow, stern, port and
// starboard points (led by the query latency) and read( ship ) turns the last results into target heave, pitch
// and roll. A slot group that changed owner is told apart from stale data by comparing the query point the result
// was computed at (query.resultInputs) with the one this ship issued.
//
// Ships without a slot (farther than the pool reaches, or no WaterQuery at all, as in the node tests) use
// proceduralHeight(): a few slow sines, the same field at the four points.
//
//   const pool = new WaterPool( app.query, { ships: 3 } );
//   pool.assign( nearestShips );  pool.queue( ship ); ... ( after query.update: ) pool.read( ship ) -> bool

import { clamp } from './util.js';

const pts = () => [ { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 } ];

// a gentle swell (m) at (x, z) and time t: amplitude `amp` scales it with the weather
export function proceduralHeight( x, z, t, amp = 1 ) {

	return amp * ( 0.18 * Math.sin( 0.21 * x + 0.9 * t ) + 0.12 * Math.sin( 0.17 * z + 1.3 * t + 1.7 ) + 0.07 * Math.sin( 0.35 * ( x + z ) + 1.9 * t ) ) * 0.8;

}

// pitch (bow up +) and roll (port up +) and heave from the four sample heights
export function poseFromHeights( hBow, hStern, hPort, hStar, cls, out = {} ) {

	out.y = ( hBow + hStern + hPort + hStar ) / 4;
	out.pitch = clamp( Math.atan2( hBow - hStern, cls.length * 0.72 ) * 0.85, - 0.25, 0.25 );
	out.roll = clamp( Math.atan2( hPort - hStar, cls.beam * 0.84 ) * 0.9, - 0.3, 0.3 );
	return out;

}

export class WaterPool {

	constructor( query, { ships = 3, points = 4, name = 'naval' } = {} ) {

		this.query = query || null;
		this.capacity = ships;
		this.per = points;
		this.start = - 1;
		if ( query && query.allocate ) {

			try {

				this.start = query.allocate( name, ships * points );

			} catch ( e ) {

				console.warn( 'naval: no WaterQuery slots left, ships use a procedural swell', e );

			}

		}

		this.owner = new Array( ships ).fill( null );
		this.issued = new Float32Array( ships * points * 2 );
		this._p = pts();
		this._h = [ 0, 0, 0, 0 ];
		this._out = {};

	}

	get ready() {

		return this.start >= 0 && !! this.query;

	}

	// give the slot groups to the nearest ships ( candidates sorted by distance, nearest first )
	assign( candidates ) {

		if ( ! this.ready ) return;
		// the nearest `capacity` candidates keep or take a group (no slice / Set per frame: capacity is a handful)
		const n = Math.min( candidates.length, this.capacity );
		for ( let g = 0; g < this.capacity; g ++ ) {

			const o = this.owner[ g ];
			if ( ! o ) continue;
			let kept = false;
			for ( let k = 0; k < n && ! kept; k ++ ) kept = candidates[ k ].id === o.id;
			if ( ! kept ) {

				o.poolGroup = - 1;
				this.owner[ g ] = null;

			}

		}

		for ( let k = 0; k < n; k ++ ) {

			const s = candidates[ k ];
			if ( s.poolGroup >= 0 && this.owner[ s.poolGroup ] === s ) continue;
			const g = this.owner.indexOf( null );
			if ( g < 0 ) break;
			this.owner[ g ] = s;
			s.poolGroup = g;
			// whatever the slots still hold belongs to the previous owner: not valid until this ship has issued its points
			this.issued.fill( NaN, g * this.per * 2, ( g + 1 ) * this.per * 2 );

		}

	}

	release( ship ) {

		const g = this.owner.indexOf( ship );
		if ( g >= 0 ) this.owner[ g ] = null;
		ship.poolGroup = - 1;

	}

	// write this ship's four query points ( where she will be when the result arrives )
	queue( ship ) {

		const g = ship.poolGroup;
		if ( ! this.ready || g === undefined || g < 0 || this.owner[ g ] !== ship ) return false;
		const lead = this.query.latency || 0.05;
		const x0 = ship.x, z0 = ship.z;
		ship.x += Math.sin( ship.yaw ) * ship.speed * lead;
		ship.z += Math.cos( ship.yaw ) * ship.speed * lead;
		ship.samplePoints( this._p );
		ship.x = x0;
		ship.z = z0;
		for ( let j = 0; j < this.per; j ++ ) {

			const i = g * this.per + j;
			this.query.setPoint( this.start + i, this._p[ j ].x, this._p[ j ].z );
			this.issued[ i * 2 ] = this._p[ j ].x;
			this.issued[ i * 2 + 1 ] = this._p[ j ].z;

		}

		return true;

	}

	// Latest results for this ship's group -> pose targets. false when she has no slots or the data is stale.
	read( ship ) {

		const g = ship.poolGroup, q = this.query;
		if ( ! this.ready || g === undefined || g < 0 || this.owner[ g ] !== ship || ! q.cpuValid ) return false;
		const tol = 8 + Math.abs( ship.speed ) * 0.5;
		for ( let j = 0; j < this.per; j ++ ) {

			const i = g * this.per + j, k = ( this.start + i ) * 4;
			const h = q.cpu[ k ];
			if ( ! Number.isFinite( h ) ) return false;
			if ( ! ( Math.abs( q.resultInputs[ k ] - this.issued[ i * 2 ] ) <= tol && Math.abs( q.resultInputs[ k + 1 ] - this.issued[ i * 2 + 1 ] ) <= tol ) ) return false;
			this._h[ j ] = h;

		}

		const o = poseFromHeights( this._h[ 0 ], this._h[ 1 ], this._h[ 2 ], this._h[ 3 ], ship.cls, this._out );
		ship.pose.ty = o.y;
		ship.pose.tpitch = o.pitch;
		ship.pose.troll = o.roll;
		return true;

	}

	// the same pose from the procedural swell
	procedural( ship, t, amp = 1 ) {

		ship.samplePoints( this._p );
		const h = this._h;
		for ( let j = 0; j < 4; j ++ ) h[ j ] = proceduralHeight( this._p[ j ].x, this._p[ j ].z, t, amp );
		const o = poseFromHeights( h[ 0 ], h[ 1 ], h[ 2 ], h[ 3 ], ship.cls, this._out );
		ship.pose.ty = o.y;
		ship.pose.tpitch = o.pitch;
		ship.pose.troll = o.roll;

	}

}
