import { ROLES, ROLE_IDS, ACTIVITY_LOOK, scheduleOf, activityAt } from './Roles.js';
import { PORTS as TRADE_PORTS } from '../trade/goods.js';

// Harbour schedules: who is where at what hour (the island clock, app.settings.timeOfDay), the work loops,
// and the population of every port. Pure logic over plain objects; the harbour feature (index.js) feeds it
// the residents (src/world/Residents.js) and the places of each port.
//
//   portSize( port ) / populationFor( port )        a port's size (trade PORTS size, else by island radius)
//   findLandSpot( ground, cx, cz, rMin, rMax, rand, taken )   a free spot on dry land near (cx, cz)
//   const d = new Director( { places, shelf } );     places: { [ portId ]: { homes, plaza, patio, tavern, mouth } }
//   d.tick( residents.list, hour, dt )                assigns tasks when an activity changes, advances work loops
//   d.activityOf( r ) / d.atWork( id )                what someone is doing now
//   d.alarm( residents.list, port, seconds, near? )   everyone of the port runs home and stays in (a raid, cannon fire)
//
// A resident is managed when its data has a role. Its activity comes from its schedule (Roles.js). "work"
// keeps a resident with its own spot or patrol there (task null); one with work stations (data.work) walks
// them in a loop: dwell s at each, and a station that `makes` something adds one to that port's shelf
// (fishers' bait, dockworkers' rope: the crafting bench sells the shelf). Far residents simply jump to
// their places (Residents.farTick), so a port keeps its day without being simulated in detail.

export const SHELF_CAP = { bait: 24, rope: 6, coin: 999 };
const TICK = 0.5; // s between schedule checks

export function hashId( id ) {

	let h = 2166136261;
	for ( const c of String( id ) ) h = Math.imul( h ^ c.charCodeAt( 0 ), 16777619 ) >>> 0;
	return h;

}

export function portSize( port ) {

	if ( ! port ) return 1;
	if ( Number.isFinite( port.size ) ) return port.size;
	if ( TRADE_PORTS[ port.id ] && Number.isFinite( TRADE_PORTS[ port.id ].size ) ) return TRADE_PORTS[ port.id ].size;
	return Math.max( 0.4, Math.min( 1.4, ( port.radius || 120 ) / 160 ) );

}

// how many residents a port should have (named ones count toward it)
export function populationFor( port ) {

	return Math.max( 2, Math.min( 12, Math.round( 1 + 4 * portSize( port ) ) ) );

}

// the role of the n-th generated resident of a port (fishers and dockworkers first, a smuggler last)
export function generatedRole( n ) {

	const order = [ 'fisher', 'dockworker', 'child', 'merchant', 'tavern', 'fisher', 'guard', 'smuggler' ];
	return order[ n % order.length ];

}

// ground: { height( x, z ), blocked?( x, z, h ) }. A spot on dry land (0.35 - 25 m up, gentle slope, not inside
// a collider), at least 2.5 m from every point of `taken`; null after 60 tries.
export function findLandSpot( ground, cx, cz, rMin, rMax, rand = Math.random, taken = [] ) {

	for ( let k = 0; k < 60; k ++ ) {

		const a = rand() * Math.PI * 2, r = rMin + ( rMax - rMin ) * rand();
		const x = cx + Math.cos( a ) * r, z = cz + Math.sin( a ) * r;
		const h = ground.height( x, z );
		if ( ! ( h > 0.35 && h < 25 ) ) continue;
		if ( Math.abs( ground.height( x + 1, z ) - ground.height( x - 1, z ) ) > 1.2 || Math.abs( ground.height( x, z + 1 ) - ground.height( x, z - 1 ) ) > 1.2 ) continue;
		if ( ground.blocked && ground.blocked( x, z, h ) ) continue;
		if ( taken.some( ( t ) => ( t.x - x ) ** 2 + ( t.z - z ) ** 2 < 6.25 ) ) continue;
		return { x: Math.round( x * 10 ) / 10, z: Math.round( z * 10 ) / 10 };

	}

	return null;

}

// slots (patio chairs, plaza spots): one resident each, the same one for the same resident when free
class Slots {

	constructor() {

		this.held = new Map(); // key -> Map( index -> resident id )

	}

	claim( key, n, id ) {

		if ( ! n ) return - 1;
		if ( ! this.held.has( key ) ) this.held.set( key, new Map() );
		const m = this.held.get( key );
		for ( const [ i, who ] of m ) if ( who === id ) return i;
		const start = hashId( id ) % n;
		for ( let k = 0; k < n; k ++ ) {

			const i = ( start + k ) % n;
			if ( ! m.has( i ) ) { m.set( i, id ); return i; }

		}

		return - 1;

	}

	release( id ) {

		for ( const m of this.held.values() ) for ( const [ i, who ] of m ) if ( who === id ) m.delete( i );

	}

}

export class Director {

	constructor( { places = {}, shelf = null, onMake = null } = {} ) {

		this.places = places;
		this.shelf = shelf || {};
		this.onMake = onMake;
		this.slots = new Slots();
		this.info = new Map(); // resident id -> { act, station, dwell }
		this.acc = TICK; // the first tick runs at once
		this.hour = 12;

	}

	place( r ) {

		return this.places[ r.port || 'home' ] || null;

	}

	activityOf( r ) {

		const i = r && this.info.get( r.id );
		return i ? i.act : null;

	}

	// at its workplace and working (crafting / tavern services check their keeper with this)
	atWork( r ) {

		const i = r && this.info.get( r.id );
		if ( ! i ) return true; // unmanaged: always there
		return i.act === 'work' && ! r.hidden && ! ( i.alarm > 0 );

	}

	// cannon fire, a raid (townlife calls it through the harbour feature): the port's people run home and stay in for
	// `seconds` (near: { x, z, radius } only those within it); then their day picks up where the clock is
	alarm( list, port, seconds = 90, near = null ) {

		let n = 0;
		for ( const r of list ) {

			if ( ( r.port || 'home' ) !== port || ! ( r.role || ( r.data && r.data.role ) ) ) continue;
			if ( near && Math.hypot( r.x - near.x, r.z - near.z ) > near.radius ) continue;
			let i = this.info.get( r.id );
			if ( ! i ) this.info.set( r.id, i = { act: null, station: 0, dwell: 0 } );
			const was = i.alarm > 0;
			i.alarm = Math.max( i.alarm || 0, seconds );
			if ( was ) continue;
			const home = this._home( r, this.place( r ) );
			if ( ! home ) continue;
			this.slots.release( r.id );
			r.setTask( { id: 'shelter', x: home.x, z: home.z, yaw: home.yaw, indoors: true, run: true } );
			n ++;

		}

		return n;

	}

	tick( list, hour, dt ) {

		this.hour = hour;
		this.acc += dt;
		if ( this.acc < TICK ) return;
		const step = this.acc;
		this.acc = 0;
		for ( const r of list ) {

			if ( ! r.role && ! ( r.data && r.data.role ) ) continue;
			const sched = scheduleOf( r.data );
			const act = activityAt( sched, hour );
			let i = this.info.get( r.id );
			if ( ! i ) {

				i = { act: null, station: 0, dwell: 0 };
				this.info.set( r.id, i );

			}

			if ( i.alarm > 0 ) {

				// sheltering: the schedule waits; afterwards the current activity is assigned afresh
				i.alarm -= step;
				if ( i.alarm > 0 ) continue;
				i.alarm = 0;
				i.act = null;

			}

			if ( i.act !== act ) {

				i.act = act;
				this.slots.release( r.id );
				i.station = this._firstStation( r );
				i.dwell = 0;
				r.setTask( this.taskFor( r, act, i ) );
				continue;

			}

			// work loops: the next station once the dwell is over
			const st = this._stations( r, act );
			if ( st && st.length > 1 && r.arrived && r.state !== 'talk' ) {

				i.dwell += step;
				const cur = st[ i.station % st.length ];
				if ( i.dwell >= ( cur.dwell || 20 ) ) {

					if ( cur.makes ) this._make( r, cur.makes );
					i.station = ( i.station + 1 ) % st.length;
					i.dwell = 0;
					r.setTask( this.taskFor( r, act, i ) );

				}

			} else if ( st && st.length === 1 && r.arrived && st[ 0 ].makes ) {

				// a single station still produces now and then
				i.dwell += step;
				if ( i.dwell >= ( st[ 0 ].dwell || 60 ) ) {

					this._make( r, st[ 0 ].makes );
					i.dwell = 0;

				}

			}

		}

	}

	_make( r, what ) {

		const port = r.port || 'home';
		const s = this.shelf[ port ] || ( this.shelf[ port ] = {} );
		s[ what ] = Math.min( SHELF_CAP[ what ] ?? 99, ( s[ what ] || 0 ) + 1 );
		if ( this.onMake ) this.onMake( { port, what, by: r.id } );

	}

	_firstStation( r ) {

		// people do not all start their loop at the same station
		const w = r.data && r.data.work;
		return w && w.length ? hashId( r.id ) % w.length : 0;

	}

	_stations( r, act ) {

		const P = this.place( r );
		if ( act === 'work' && r.data && r.data.work && r.data.work.length ) return r.data.work;
		if ( act === 'watch' ) {

			if ( r.data && r.data.work && r.data.work.length ) return r.data.work;
			if ( P && P.mouth && P.mouth.length ) return P.mouth.map( ( m ) => ( { ...m, dwell: 45, ...ACTIVITY_LOOK.watch } ) );

		}

		return null;

	}

	// the task for an activity (null: the resident's own spot or patrol)
	taskFor( r, act, i = { station: 0 } ) {

		const d = r.data || {};
		const P = this.place( r );
		const native = !! ( d.spot && ! d.work ) || !! d.patrol;
		const home = this._home( r, P );
		const look = ACTIVITY_LOOK[ act ] || {};
		const at = ( id, pt, extra = {} ) => ( { id, x: pt.x, z: pt.z, yaw: pt.yaw, base: look.base, gestures: look.gestures, ...extra } );
		const slot = ( key, list, id, extra ) => {

			if ( ! list || ! list.length ) return null;
			const k = this.slots.claim( key, list.length, r.id );
			return k < 0 ? null : at( id, list[ k ], extra );

		};

		switch ( act ) {

			case 'sleep':
				return home ? at( 'sleep', home, { indoors: true } ) : null;
			case 'wake':
				return home ? at( 'wake', home ) : null;
			case 'eat':
				return slot( 'plaza', P && P.plaza, 'eat' ) || ( native ? null : home ? at( 'eat', home ) : null );
			case 'tavern': {

				if ( P && P.tavern ) return slot( 'patio', P.patio, 'tavern' ) || at( 'tavernIn', P.tavern, { indoors: true } );
				return slot( 'plaza', P && P.plaza, 'eat' ) || ( home ? at( 'sleep', home, { indoors: true } ) : null );

			}

			case 'play':
				if ( native ) return null;
				return slot( 'plaza', P && P.plaza, 'play' ) || null;
			case 'loiter':
				if ( native ) return null;
				return slot( 'patio', P && P.patio, 'loiter' ) || slot( 'plaza', P && P.plaza, 'loiter' );
			case 'watch':
			case 'work': {

				const st = this._stations( r, act );
				if ( st ) {

					const s = st[ i.station % st.length ];
					return { id: act + ':' + ( i.station % st.length ), x: s.x, z: s.z, yaw: s.yaw, base: s.base, gestures: s.gestures, work: !! s.work };

				}

				if ( native ) return null;
				const w = ROLES[ d.role ] && ROLES[ d.role ].work;
				return home ? at( 'work', home, w ? { base: w.base, gestures: w.gestures } : {} ) : null;

			}

			default:
				return null;

		}

	}

	_home( r, P ) {

		const h = r.data && r.data.home;
		if ( h && typeof h === 'object' ) return h;
		if ( h && P && P.homes && P.homes[ h ] ) return P.homes[ h ].door || P.homes[ h ];
		return null;

	}

}

export { ROLE_IDS };
