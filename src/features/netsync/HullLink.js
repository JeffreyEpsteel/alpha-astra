// Hull collisions of the other players' boats (wave 11). The naval feature's own CollisionWorld knows the local boat and the
// ships; this adds the remote boats, with the room's host as the authority (the same host that runs the ships):
//
//   host    every remote boat against every ship, against the host's own boat and against the other remote boats, with the
//           Collisions.js maths (SAT boxes, resolveContact, ramDamage, one damage event per new contact). The ships and the
//           host's boat take their part of the impulse (and damage) here; a remote boat's part goes to its owner as a 'bump'
//           { to, j, p, dmg, v, by, f } that the server forwards to that player alone. A blow also sends fx 'ram' (splinters,
//           a splash and the crunch for everybody else).
//   all     prediction: the local boat is pushed clear of every remote boat as this client shows it, so hulls never overlap on
//           screen. Positional only: the bounce and the damage are the host's (they arrive one round trip later).
//   owner   onBump( m ) applies the impulse through BoatController.applyCollision and the damage through naval.damagePlayer:
//           damage to a player's hull is always applied on that player's machine.
//
// The remote boats' velocity, mass and hull points ride in their state as hv: [ vx, vz, w, mass, maxHp ] (NetSync.decorateState);
// without it the velocity is taken from the interpolated pose. A remote pose is ~0.2 s old and already pushed clear by its
// owner, so a remote pair counts as touching within HULL.margin, and after an impulse the pair waits HULL.cool.
//
//   const hulls = new HullLink( sync );  hulls.bind( net );  hulls.update( dt );  hulls.onBump( m );  hulls.onRam( m )
//   hulls.stats { contacts, blows, bumpsOut, bumpsIn, pushes, rams }

import { obb2, satOverlap, contactPoint, resolveContact, isBowOn, ramDamage, yawInertia, COLLIDE } from '../naval/Collisions.js';
import { BOATS } from '../../game/Boats.js';
import { MAX_BUMP_DAMAGE } from '../../net/Protocol.js';

export const HULL = {
	margin: 0.5, // m: a remote hull this close counts as touching (its pose is old and its owner already pushed it clear)
	cool: 0.4, // s between two impulses of one pair (the owner needs a round trip to show the first)
	slop: 0.02, // m of overlap the prediction leaves
	park: - 100, // m: a boat below this is parked (a wreck's hidden model) and solid to nobody
	maxDv: 12, // m/s: the most one bump may change a boat's way
	kickAt: 4, // m/s: a harder bump shakes the camera
	forget: 30, // s: an idle pair is forgotten
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const r1 = ( v ) => Math.round( v * 10 ) / 10;
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const finite = ( a, n ) => Array.isArray( a ) && a.length >= n && a.slice( 0, n ).every( Number.isFinite );

// heading (rad about +Y, 0 = +Z) of a quaternion: its forward vector on the water plane
export function yawOf( q ) {

	const fx = 2 * ( q.x * q.z + q.w * q.y ), fz = 1 - 2 * ( q.x * q.x + q.y * q.y );
	return Math.atan2( fx, fz );

}

export class HullLink {

	constructor( sync ) {

		this.sync = sync;
		this.time = 0;
		this.pairs = new Map(); // 'idA|idB' -> { armed, last (damage), jt (impulse), seen }
		this.bodies = new Map(); // peer id -> body record
		this.stats = { contacts: 0, blows: 0, bumpsOut: 0, bumpsIn: 0, pushes: 0, rams: 0 };
		this._offs = [];
		this._frame = 0;
		this._local = null;
		this._list = [];
		this._others = [];
		this._sat = {};

	}

	get app() {

		return this.sync.app;

	}

	_naval() {

		const f = this.sync.features;
		return f && f.get ? f.get( 'naval' ) : null;

	}

	bind( net ) {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.pairs.clear();
		this.bodies.clear();
		if ( ! net ) return;
		this._offs.push( net.on( 'bump', ( m ) => this.onBump( m ) ) );
		this._offs.push( net.on( 'fx', ( m ) => { if ( m && m.kind === 'ram' ) this.onRam( m ); } ) );

	}

	update( dt ) {

		this.time += dt;
		const net = this.sync.net, rp = this.app.remotePlayers;
		if ( ! net || ! net.online || ! rp || ! rp.peers ) return;
		const remotes = this._remotes( rp, dt );
		if ( ! remotes.length ) return;
		if ( net.isHost ) this._host( remotes );
		this._predict( remotes );

	}

	// ------------------------------------------------------------------ bodies

	// the remote boats as collision bodies (their push is a no-op: the owner moves them; their impulse is collected for the bump)
	_remotes( rp, dt ) {

		const out = this._list;
		out.length = 0;
		const seen = new Set();
		for ( const [ id, p ] of rp.peers ) {

			const st = p.boatState, spec = st ? BOATS[ st.id ] : null;
			if ( ! spec || ! p.hasPose || p.riding || ! p.boatPos || ! p.boatQuat || ! ( p.boatPos.y > HULL.park ) ) continue;
			seen.add( id );
			let r = this.bodies.get( id );
			if ( ! r ) this.bodies.set( id, r = this._makeRemote( id ) );
			const x = p.boatPos.x, z = p.boatPos.z;
			const hv = p.extra && finite( p.extra.hv, 3 ) ? p.extra.hv : null;
			if ( hv ) {

				r.vx = clamp( hv[ 0 ], - 60, 60 );
				r.vz = clamp( hv[ 1 ], - 60, 60 );
				r.w = clamp( hv[ 2 ], - 5, 5 );

			} else if ( r.placed && dt > 0 && Math.hypot( x - r.x, z - r.z ) < 40 * dt + 2 ) {

				// no reported way: a smoothed one from the pose (a jump, a respawn, resets it)
				const k = 1 - Math.exp( - dt * 4 );
				r.vx += ( ( x - r.x ) / dt - r.vx ) * k;
				r.vz += ( ( z - r.z ) / dt - r.vz ) * k;
				r.w = 0;

			} else r.vx = r.vz = r.w = 0;

			r.placed = true;
			r.x = x;
			r.z = z;
			r.yaw = yawOf( p.boatQuat );
			r.hx = spec.beam / 2;
			r.hz = spec.length / 2;
			r.mass = hv && hv[ 3 ] > 0 ? hv[ 3 ] : spec.mass || 3200;
			r.invMass = 1 / r.mass;
			r.invI = 1 / yawInertia( r.mass, r.hx, r.hz );
			r.maxHp = hv && hv[ 4 ] > 0 ? hv[ 4 ] : spec.hp || 40 + 0.07 * r.mass;
			r.boat = st.id;
			out.push( r );

		}

		for ( const id of [ ...this.bodies.keys() ] ) if ( ! seen.has( id ) ) this.bodies.delete( id );
		return out;

	}

	_makeRemote( peer ) {

		const r = { id: 'peer:' + peer, peer, remote: true, gentle: false, jx: 0, jz: 0, placed: false, x: 0, z: 0, vx: 0, vz: 0, w: 0 };
		r.push = () => {}; // (its owner pushes it clear on its own machine)
		r.impulse = ( jx, jz ) => {

			r.jx += jx;
			r.jz += jz;
			r.vx += jx * r.invMass;
			r.vz += jz * r.invMass;

		};

		return r;

	}

	// the local boat (null while there is none, she is parked, sinking or a wreck)
	_localBody() {

		const app = this.app, b = app.boatCtl, n = this._naval();
		if ( ! b || ! b.position || ! b.quaternion || b.enabled === false || ! ( b.position.y > HULL.park ) ) return null;
		if ( n && ( n.sinking || ( n.playerHull && n.playerHull.sunk ) ) ) return null;
		const st = app.game && app.game.state;
		const id = app.boatId || ( st && st.boat ) || ( n && n.playerHull && n.playerHull.boat ) || null;
		const spec = BOATS[ id ];
		if ( ! spec ) return null;
		const r = this._local || ( this._local = this._makeLocal() );
		const d = n && typeof n._dims === 'function' ? n._dims() : null;
		r._b = b;
		r.x = b.position.x;
		r.z = b.position.z;
		r.yaw = yawOf( b.quaternion );
		r.hx = ( d ? d.beam : spec.beam ) / 2;
		r.hz = ( d ? d.length : spec.length ) / 2;
		r.mass = b.mass || spec.mass || 3200;
		r.invMass = 1 / r.mass;
		r.invI = 1 / ( ( b.inertia && b.inertia.y ) || yawInertia( r.mass, r.hx, r.hz ) );
		r.vx = b.velocity ? b.velocity.x : 0;
		r.vz = b.velocity ? b.velocity.z : 0;
		r.w = b.angular ? b.angular.y : 0;
		r.maxHp = n && n.playerHull && n.playerHull.max > 0 ? n.playerHull.max : spec.hp || 40 + 0.07 * r.mass;
		return r;

	}

	_makeLocal() {

		const r = { id: 'local', local: true, gentle: false, _b: null };
		r.push = () => {}; // (the prediction pass moves her)
		r.impulse = ( jx, jz, px, pz ) => {

			const b = r._b;
			if ( typeof b.applyCollision === 'function' ) b.applyCollision( 0, 0, jx, jz, px, ( b.position.y || 0 ) + 0.4, pz );
			else if ( b.velocity ) {

				b.velocity.x += jx * r.invMass;
				b.velocity.z += jz * r.invMass;

			}

			if ( b.velocity ) {

				r.vx = b.velocity.x;
				r.vz = b.velocity.z;

			}

			if ( b.angular ) r.w = b.angular.y;

		};

		return r;

	}

	// the host's ships, through the naval feature's own bodies (Naval._shipBody: grounded / moored ones are immovable)
	_ships( out ) {

		const n = this._naval();
		if ( ! n || ! Array.isArray( n.ships ) || typeof n._shipBody !== 'function' ) return;
		for ( const s of n.ships ) {

			if ( ! s || ! s.alive || s.puppet ) continue;
			try {

				const b = n._shipBody( s );
				if ( b ) out.push( b );

			} catch ( e ) { /* a ship this build cannot box */ }

		}

	}

	// ------------------------------------------------------------------ host

	_host( remotes ) {

		this._frame ++;
		const others = this._others;
		others.length = 0;
		const lb = this._localBody();
		if ( lb ) others.push( lb );
		this._ships( others );
		for ( let i = 0; i < remotes.length; i ++ ) {

			const a = remotes[ i ];
			for ( const b of others ) this._pair( a, b );
			for ( let j = i + 1; j < remotes.length; j ++ ) this._pair( a, remotes[ j ] );

		}

		// pairs apart this frame are armed for the next blow
		for ( const [ k, p ] of this.pairs ) {

			if ( p.seen === this._frame ) continue;
			p.armed = true;
			if ( this.time - Math.max( p.last, p.jt ) > HULL.forget ) this.pairs.delete( k );

		}

	}

	_pair( a, b ) {

		const reach = Math.hypot( a.hx, a.hz ) + Math.hypot( b.hx, b.hz ) + HULL.margin + COLLIDE.skin;
		if ( Math.abs( b.x - a.x ) > reach || Math.abs( b.z - a.z ) > reach ) return;
		const A = obb2( a.x, a.z, a.yaw, a.hx, a.hz ), B = obb2( b.x, b.z, b.yaw, b.hx, b.hz );
		const s = satOverlap( A, B, this._sat );
		if ( s.sep > HULL.margin + COLLIDE.skin ) return; // apart (re-armed after the loop)
		const key = a.id < b.id ? `${ a.id }|${ b.id }` : `${ b.id }|${ a.id }`;
		let p = this.pairs.get( key );
		if ( ! p ) this.pairs.set( key, p = { armed: true, last: - Infinity, jt: - Infinity, seen: 0 } );
		p.seen = this._frame;
		if ( s.sep > HULL.margin ) return; // within the skin: touching
		if ( this.time - p.jt < HULL.cool ) return; // the last impulse is still on its way to the owner
		const nx = s.nx, nz = s.nz, depth = Math.max( 0, - s.sep );
		const pt = contactPoint( A, B, nx, nz );
		const c = { x: pt.x, z: pt.z, nx, nz, depth };
		const bowA = isBowOn( a, nx, nz, pt ), bowB = isBowOn( b, - nx, - nz, pt );
		if ( a.remote ) a.jx = a.jz = 0;
		if ( b.remote ) b.jx = b.jz = 0;
		const r = resolveContact( a, b, c );
		let dA = 0, dB = 0;
		if ( p.armed && ! a.gentle && ! b.gentle && r.vClose > COLLIDE.minSpeed && this.time - p.last >= COLLIDE.minGap ) {

			p.armed = false;
			p.last = this.time;
			dA = ramDamage( a, b, r.vClose, bowA, bowB );
			dB = ramDamage( b, a, r.vClose, bowB, bowA );

		}

		if ( ! ( r.jn > 0 ) && ! dA && ! dB ) return;
		if ( r.jn > 0 ) p.jt = this.time;
		this.stats.contacts ++;
		this._apply( a, b, dA, r.vClose, c );
		this._apply( b, a, dB, r.vClose, c );
		if ( dA > 0 || dB > 0 ) this._blow( a, b, r.vClose, c, dA, dB );

	}

	// one side of a resolved contact: a remote boat's goes to its owner, the host's boat and the ships take theirs here
	_apply( self, other, d, v, c ) {

		const n = this._naval(), net = this.sync.net;
		if ( self.remote ) {

			if ( ! ( Math.abs( self.jx ) + Math.abs( self.jz ) > 0 ) && ! ( d > 0 ) ) return;
			const m = {
				t: 'bump', to: self.peer, j: [ r1( self.jx ), r1( self.jz ) ], p: [ r2( c.x ), r2( c.z ) ], dmg: r1( d ), v: r2( v ),
				by: other.remote ? other.peer : other.local ? net.id : String( other.id ), f: [ r1( other.x ), r1( other.z ) ],
			};
			if ( net.sendMsg( m ) ) this.stats.bumpsOut ++;
			return;

		}

		if ( ! ( d > 0 ) || ! n ) return;
		if ( self.local ) {

			if ( typeof n.damagePlayer === 'function' ) n.damagePlayer( d, 'ramming', { x: other.x, z: other.z } );

		} else if ( self.ship && self.ship.alive ) {

			const s = self.ship;
			const sunk = s.damage( d, { part: 'hull', by: other.remote ? 'remote:' + other.peer : 'player' } );
			if ( sunk ) {

				if ( typeof n._onSunk === 'function' ) n._onSunk( s, false );
				// a remote boat rammed her under: the credit is its owner's (NavalLink.onFx 'sink')
				if ( other.remote ) net.sendFx( { kind: 'sink', ship: s.id, by: other.peer, x: s.x, z: s.z } );

			}

		}

	}

	// a blow on the host: the show here, fx 'ram' for everybody else, the event
	_blow( a, b, v, c, dA, dB ) {

		this.stats.blows ++;
		const net = this.sync.net;
		this._ramFx( c.x, 1, c.z, v );
		for ( const [ self, d ] of [ [ a, dA ], [ b, dB ] ] ) {

			const n = this._naval();
			if ( d > 0.04 * ( self.maxHp || 100 ) && n && n.planks && n.planks.burst ) n.planks.burst( c.x, c.z, 2, 1.5 ); // stove in

		}

		const de = this.sync.features && this.sync.features.get ? this.sync.features.get( 'destruction' ) : null;
		if ( de && typeof de.impulse === 'function' ) {

			const mu = a.mass * b.mass / Math.max( 1, a.mass + b.mass );
			try { de.impulse( c.x, 1, c.z, 4 + v, 0.5 * mu * v * v ); } catch ( e ) { /* decoration */ }

		}

		const local = !! ( a.local || b.local );
		if ( local ) this._kick( v );
		net.sendFx( { kind: 'ram', x: r2( c.x ), y: 1, z: r2( c.z ), v: r1( v ) } );
		this._emit( 'hullsCollided', {
			a: a.id, b: b.id, x: c.x, z: c.z, speed: r1( v ), damage: { a: r1( dA ), b: r1( dB ) }, byPlayer: local, remote: true,
		} );

	}

	// ------------------------------------------------------------------ everybody

	// the local boat out of every remote hull as this client draws them (the remote boat counts as immovable here: its owner
	// does the same on its machine, so on every screen the hulls only touch)
	_predict( remotes ) {

		const lb = this._localBody();
		if ( ! lb ) return;
		const b = lb._b;
		for ( const r of remotes ) {

			const reach = Math.hypot( lb.hx, lb.hz ) + Math.hypot( r.hx, r.hz );
			if ( Math.abs( r.x - lb.x ) > reach || Math.abs( r.z - lb.z ) > reach ) continue;
			const s = satOverlap( obb2( lb.x, lb.z, lb.yaw, lb.hx, lb.hz ), obb2( r.x, r.z, r.yaw, r.hx, r.hz ), this._sat );
			if ( ! s.hit ) continue;
			const corr = s.depth - HULL.slop;
			if ( corr <= 0 ) continue;
			const dx = - s.nx * corr, dz = - s.nz * corr; // (n points from the local hull to the remote one)
			if ( typeof b.applyCollision === 'function' ) b.applyCollision( dx, dz, 0, 0 );
			else {

				b.position.x += dx;
				b.position.z += dz;

			}

			lb.x = b.position.x;
			lb.z = b.position.z;
			this.stats.pushes ++;

		}

	}

	// the host resolved a collision of our boat: its impulse and its damage are ours to apply
	onBump( m ) {

		const net = this.sync.net;
		if ( ! m || ! net || ! net.online || m.from !== net.host || ! finite( m.j, 2 ) || ! finite( m.p, 2 ) ) return false;
		const b = this.app.boatCtl, n = this._naval();
		if ( ! b || ! b.position || b.enabled === false ) return false;
		if ( n && ( n.sinking || ( n.playerHull && n.playerHull.sunk ) ) ) return false;
		this.stats.bumpsIn ++;
		const mass = b.mass || 3200, cap = HULL.maxDv * mass;
		let jx = m.j[ 0 ], jz = m.j[ 1 ];
		const jl = Math.hypot( jx, jz );
		if ( jl > cap ) {

			jx *= cap / jl;
			jz *= cap / jl;

		}

		const px = m.p[ 0 ], pz = m.p[ 1 ];
		if ( typeof b.applyCollision === 'function' ) b.applyCollision( 0, 0, jx, jz, px, ( b.position.y || 0 ) + 0.4, pz );
		else if ( b.velocity ) {

			b.velocity.x += jx / mass;
			b.velocity.z += jz / mass;

		}

		const d = clamp( + m.dmg || 0, 0, MAX_BUMP_DAMAGE );
		const from = finite( m.f, 2 ) ? { x: m.f[ 0 ], z: m.f[ 1 ] } : { x: px, z: pz };
		if ( d > 0 && n && typeof n.damagePlayer === 'function' ) n.damagePlayer( d, 'ramming', from );
		const v = + m.v || 0;
		if ( d > 0 || v > HULL.kickAt ) {

			this._kick( v );
			this._emit( 'hullsCollided', { a: 'player', b: String( m.by || '' ), x: px, z: pz, speed: v, damage: { a: d, b: 0 }, byPlayer: true, remote: true } );

		}

		return true;

	}

	// another machine's blow (the host's fx 'ram'): splinters, a splash, the crunch
	onRam( m ) {

		const net = this.sync.net;
		if ( ! m || ( net && m.id === net.id ) || ! [ m.x, m.z ].every( Number.isFinite ) ) return;
		this._ramFx( m.x, Number.isFinite( m.y ) ? m.y : 1, m.z, Number.isFinite( m.v ) ? m.v : 2 );

	}

	_ramFx( x, y, z, v ) {

		this.stats.rams ++;
		const n = this._naval(), f = this.sync.features, vfx = f && f.get ? f.get( 'vfx' ) : null;
		const k = clamp( v / 4, 0.3, 3 );
		if ( vfx ) {

			if ( vfx.splinters ) vfx.splinters( x, y + 0.4, z, k );
			if ( vfx.debris ) vfx.debris( x, y, z, k * 0.8, 'wood' );
			if ( vfx.splash ) vfx.splash( x, 0, z, k * 0.8 );

		} else if ( n && n.fx ) {

			if ( n.fx.hit ) n.fx.hit( x, y, z );
			if ( n.fx.splash ) n.fx.splash( x, 0, z, k * 0.8 );

		}

		if ( n && n.audio && n.audio.crunch ) n.audio.crunch( x, y, z, clamp( 0.45 + v / 10, 0.45, 1 ) );

	}

	_kick( v ) {

		const cf = this.app.cameraFeel;
		if ( cf && cf.kick ) try { cf.kick( v > HULL.kickAt ? 'broadside' : 'hit', { scale: clamp( v / 5, 0.4, 1.6 ) } ); } catch ( e ) { /* optional */ }

	}

	_emit( name, e ) {

		const f = this.sync.features;
		if ( f && f.emit ) try { f.emit( name, e ); } catch ( err ) { console.warn( `netsync: ${ name } listener threw`, err ); }

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.pairs.clear();
		this.bodies.clear();

	}

}
