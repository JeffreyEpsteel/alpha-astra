// The rescue's boats and the boats you left, for everybody in the room (wave 16A).
//
//   launch   the harbour launch (or the merchant) the rescue feature sends sails on the machine that fired the flare. The
//            host's rides the host's ship list already (naval.ships -> NavalLink's 'world', kind 'launch': the others draw a
//            puppet with the procedural model, rescue's drawProcedural). A guest's is not in that list, so it rides the
//            guest's player state, as a parachute does (PlaneLink's chute): rl: [ kind, x, z, yaw, speed ]. The others draw it
//            (naval's ModelSet: a LaunchVisual, else world/boat/Launch.js directly) where the newest state puts it, dead-reckoned
//            on its speed between states and eased.
//   left     the boats you left moored when you took another vessel (hijack.left) ride the state as lb: [ [ boat, x, z, heading ] ]
//            (at most 6); the others get them as entries of the moored list netsync already draws (sync.moored ->
//            RemotePlayers.setMoored: the hull and a "<name> · moored" tag), keyed 'left:<peer>:<n>'.
// The server passes both fields through (Protocol: unknown lowerCamel state fields within MAX_EXTRA; no schema, no room code).
//
//   const rl = new RescueLink( sync );  rl.bind( net );  rl.decorate( state );  rl.update( dt );  rl.dispose()
//   rl.remote   Map peer id -> { id, kind, x, z, yaw, speed, visual }      rl.left   Set of the moored keys it added
//   rl.stats    { out, in, added, removed, left }
//   sync.opts.rescueVisual( kind, peerId ) -> a visual with apply( ship, pose ) / setVisible / dispose (tests)

import { BOATS } from '../../game/Boats.js';
import { SHIP_CLASSES } from '../naval/ShipClasses.js';
import { LaunchVisual } from '../../world/boat/Launch.js';

export const RESCUE_SYNC = {
	ease: 6, // 1/s toward the dead-reckoned state
	reckon: 0.8, // s of dead reckoning at most
	leftEvery: 0.5, // s between two looks at the others' left boats
	maxLeft: 6,
};

const r2 = ( v ) => Math.round( v * 100 ) / 100;
const r3 = ( v ) => Math.round( v * 1000 ) / 1000;
const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
const fin = ( ...v ) => v.every( Number.isFinite );
const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );

export class RescueLink {

	constructor( sync ) {

		this.sync = sync;
		this.remote = new Map();
		this.left = new Set();
		this.stats = { out: 0, in: 0, added: 0, removed: 0, left: 0 };
		this._leftT = 0;
		this._leftSig = '';
		this._seen = new Set();

	}

	_f( name ) {

		const f = this.sync.features;
		return f && f.get ? f.get( name ) : null;

	}

	bind() {

		this.clear();

	}

	// ------------------------------------------------------------------ out: the local player's state

	decorate( s ) {

		if ( ! s ) return s;
		const net = this.sync.net;
		const r = this._f( 'rescue' );
		const e = r && r.launchEntry ? r.launchEntry() : null;
		// (the host's own launch is in the ships NavalLink sends: not twice)
		if ( e && fin( e.x, e.z, e.yaw ) && ! ( e.inNaval && net && net.isHost ) ) {

			s.rl = [ String( e.kind ).slice( 0, 16 ), r2( e.x ), r2( e.z ), r3( wrap( e.yaw ) ), r2( e.speed || 0 ) ];
			this.stats.out ++;

		}

		const hj = this._f( 'hijack' );
		if ( hj && Array.isArray( hj.left ) && hj.left.length ) {

			const lb = [];
			for ( const b of hj.left.slice( - RESCUE_SYNC.maxLeft ) ) if ( b && BOATS[ b.boat ] && fin( b.x, b.z ) ) lb.push( [ b.boat, r2( b.x ), r2( b.z ), r3( b.heading || 0 ) ] );
			if ( lb.length ) s.lb = lb;

		}

		return s;

	}

	// ------------------------------------------------------------------ in: the others' launches

	_visual( kind, id ) {

		const make = this.sync.opts && this.sync.opts.rescueVisual;
		if ( make ) return make( kind, id );
		const nv = this._f( 'naval' );
		if ( nv && nv.models && nv.models.create ) {

			const r = this._f( 'rescue' );
			if ( r && r._patchModels ) r._patchModels(); // (the launch's procedural model)
			try { return nv.models.create( kind ); } catch ( e ) { /* below */ }

		}

		const scene = this.sync.app && this.sync.app.scene;
		return scene && kind === 'launch' ? new LaunchVisual( { scene } ) : null;

	}

	_launches( rp, dt ) {

		const seen = this._seen;
		seen.clear();
		if ( rp && rp.peers ) for ( const [ id, p ] of rp.peers ) {

			const e = p.extra && p.extra.rl;
			if ( ! Array.isArray( e ) || e.length < 5 || ! SHIP_CLASSES[ e[ 0 ] ] || ! fin( e[ 1 ], e[ 2 ], e[ 3 ], e[ 4 ] ) ) continue;
			seen.add( id );
			let v = this.remote.get( id );
			if ( v && v.kind !== e[ 0 ] ) {

				this._drop( id, v );
				v = null;

			}

			if ( ! v ) {

				const cls = SHIP_CLASSES[ e[ 0 ] ];
				v = {
					id, kind: e[ 0 ], x: e[ 1 ], z: e[ 2 ], yaw: e[ 3 ], speed: e[ 4 ], lastAt: - 1,
					net: { x: e[ 1 ], z: e[ 2 ], yaw: e[ 3 ], speed: e[ 4 ], at: now() }, visual: null,
					ship: { kind: e[ 0 ], cls, x: e[ 1 ], z: e[ 2 ], yaw: e[ 3 ], speed: e[ 4 ], yawRate: 0, pose: { y: 0, pitch: 0, roll: 0 } },
				};
				try { v.visual = this._visual( v.kind, id ); } catch ( err ) { v.visual = null; }
				this.remote.set( id, v );
				this.stats.added ++;

			}

			// a new state: the target moves
			if ( p.lastAt !== v.lastAt ) {

				v.lastAt = p.lastAt;
				v.net = { x: e[ 1 ], z: e[ 2 ], yaw: e[ 3 ], speed: e[ 4 ], at: now() };
				this.stats.in ++;

			}

			const t = v.net, age = Math.min( RESCUE_SYNC.reckon, Math.max( 0, ( now() - t.at ) / 1000 ) );
			const px = t.x + Math.sin( t.yaw ) * t.speed * age, pz = t.z + Math.cos( t.yaw ) * t.speed * age;
			const k = 1 - Math.exp( - dt * RESCUE_SYNC.ease );
			const dy = wrap( t.yaw - v.yaw );
			v.x += ( px - v.x ) * k;
			v.z += ( pz - v.z ) * k;
			v.yaw = wrap( v.yaw + dy * k );
			v.speed = t.speed;
			const sh = v.ship;
			sh.yawRate = dt > 0 ? Math.max( - 0.6, Math.min( 0.6, dy * k / dt ) ) : 0;
			sh.x = v.x;
			sh.z = v.z;
			sh.yaw = v.yaw;
			sh.speed = v.speed;
			if ( v.visual ) {

				if ( v.visual.apply ) v.visual.apply( sh, sh.pose );
				if ( v.visual.setVisible ) v.visual.setVisible( true );

			}

		}

		for ( const [ id, v ] of this.remote ) if ( ! seen.has( id ) ) this._drop( id, v );

	}

	_drop( id, v ) {

		if ( v.visual && v.visual.dispose ) try { v.visual.dispose(); } catch ( e ) { /* gone */ }
		this.remote.delete( id );
		this.stats.removed ++;

	}

	// ------------------------------------------------------------------ in: the others' left boats -> the moored list

	_leftBoats( rp ) {

		const sync = this.sync, want = new Map();
		if ( rp && rp.peers ) for ( const [ id, p ] of rp.peers ) {

			const lb = p.extra && p.extra.lb;
			if ( ! Array.isArray( lb ) ) continue;
			lb.slice( 0, RESCUE_SYNC.maxLeft ).forEach( ( b, i ) => {

				if ( ! Array.isArray( b ) || ! BOATS[ b[ 0 ] ] || ! fin( b[ 1 ], b[ 2 ] ) ) return;
				const h = Number.isFinite( b[ 3 ] ) ? b[ 3 ] : 0, key = `left:${ id }:${ i }`;
				want.set( key, { captain: key, name: `${ p.name || '?' }'s ${ BOATS[ b[ 0 ] ].name.toLowerCase() }`, boat: b[ 0 ], p: [ b[ 1 ], 0, b[ 2 ] ], q: [ 0, r3( Math.sin( h / 2 ) ), 0, r3( Math.cos( h / 2 ) ) ] } );

			} );

		}

		const sig = [ ...want.values() ].map( ( b ) => `${ b.captain }|${ b.boat }|${ b.p[ 0 ] }|${ b.p[ 2 ] }|${ b.q[ 1 ] }` ).join( ';' );
		const lost = [ ...this.left ].some( ( k ) => ! sync.moored.has( k ) ); // (a universe welcome clears the list)
		if ( sig === this._leftSig && ! lost ) return;
		this._leftSig = sig;
		for ( const k of this.left ) if ( ! want.has( k ) ) sync.moored.delete( k );
		this.left = new Set( want.keys() );
		for ( const [ k, b ] of want ) sync.moored.set( k, b );
		this.stats.left = this.left.size;
		if ( sync._showMoored ) sync._showMoored();

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		const net = this.sync.net, rp = this.sync.app && this.sync.app.remotePlayers;
		if ( ! net || ! net.online ) {

			if ( this.remote.size || this.left.size ) this.clear();
			return;

		}

		this._launches( rp, dt );
		this._leftT -= dt;
		if ( this._leftT <= 0 ) {

			this._leftT = RESCUE_SYNC.leftEvery;
			this._leftBoats( rp );

		}

	}

	clear() {

		for ( const [ id, v ] of [ ...this.remote ] ) this._drop( id, v );
		const sync = this.sync;
		if ( this.left.size && sync.moored ) {

			for ( const k of this.left ) sync.moored.delete( k );
			if ( sync._showMoored ) sync._showMoored();

		}

		this.left.clear();
		this._leftSig = '';
		this._leftT = 0;

	}

	dispose() {

		this.clear();

	}

}
