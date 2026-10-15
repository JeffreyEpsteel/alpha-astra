// Planes everybody sees (wave 13): the other players' airframes with their livery and upgrades, a pilot under a parachute, the
// plane she bailed out of flying on, and the airframe each player has out at the ramp / the airstrip pad.
//
//   flying   the state's `plane` field (Seaplane.decorateState: p, q, thr, af, liv; this link adds up, the fitted upgrades as
//            one digit each in Airframes.UPGRADE_IDS order) feeds seaplane.updateRemote with each NEW state only (the remote
//            planes interpolate between real samples); a peer whose state lost its `plane` loses the remote plane at once
//            (the parked or stray entry below takes over instead of a frozen plane hanging there for a few seconds).
//   chute    while the local player hangs under the canopy the state carries chute: [ x, y, z, heading, open 0..1 ]; the others
//            draw the canopy (Chute.js's own mesh, passive) over that peer's interpolated avatar.
//   stray    the abandoned plane keeps flying on its owner's machine (Seaplane._flyAbandoned): the owner streams its pose as
//            the schema entry '<owner>:stray' (10 Hz) until it wrecks (then WreckLink's 'plane' wreck entry takes over) or
//            glides down and stops (then it is parked where it lies).
//   parked   the airframe out (sp.af, owned, not flown, not lost) as '<owner>:parked': the Kestrel on the airstrip pad, a
//            floatplane at the ramp or left at sea. Sent when it moved.
// The player's own state is fixed up too: the pilot's mode 'plane' (Player.js) is not a protocol mode, so it goes as 'seat'
// (seated, at the cockpit seat / the harness), and while on the chute the avatar faces its heading.
//
//   const pl = new PlaneLink( sync );  pl.bind( net );  pl.update( dt );  pl.decorate( state );  pl.feed( remotePlayers )
//   pl.remote (Map key -> view { key, owner, kind, af, liv, up, visual })  pl.chutes (Map peer id -> view)
//   pl.local() -> the entries this player owns now;  pl.stats { out, dels, added, removed, chutes, fed }

import { Vector3, Quaternion } from '../../engine/index.js';
import { UPGRADE_IDS, UPGRADES } from '../seaplane/Airframes.js';
import { Chute } from '../seaplane/Chute.js';

export const PLANE_SYNC = {
	stray: 0.1, // s between two poses of a stray plane
	parked: 0.5, // s between two looks at a parked one
	resend: 1.5, // s before an unanswered set / del goes again
	move: 0.05, turn: 0.002, // a stray's pose this close to its entry is not sent again (m, 1 - |dot|)
	parkMove: 0.3, parkTurn: 0.003,
	interp: 150, // ms a remote stray is drawn behind its newest sample
	keep: 8,
	ease: 3, // 1/s: a parked plane eases to a moved entry
};

const _Y = new Vector3( 0, 1, 0 ), _p = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion();
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const r3 = ( v ) => Math.round( v * 1000 ) / 1000;
const r4 = ( v ) => Math.round( v * 1e4 ) / 1e4;
const wrap = ( a ) => ( ( a + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI;
const now = () => ( typeof performance !== 'undefined' ? performance.now() : Date.now() );
const fin = ( a, n ) => Array.isArray( a ) && a.length >= n && a.slice( 0, n ).every( Number.isFinite );

// the fitted upgrades as one digit each (UPGRADE_IDS order) and back
export function upgradeCode( u ) {

	if ( ! u || typeof u !== 'object' ) return '';
	return UPGRADE_IDS.map( ( id ) => Math.max( 0, Math.min( 9, Math.round( Number( u[ id ] ) || 0 ) ) ) ).join( '' );

}

export function upgradesOf( code ) {

	const out = {};
	UPGRADES.forEach( ( U, i ) => { out[ U.id ] = Math.min( U.tiers, ( typeof code === 'string' && /^[0-9]$/.test( code[ i ] || '' ) ) ? + code[ i ] : 0 ); } );
	return out;

}

// the default remote canopy: Chute.js's own mesh, never stepped (the pose comes from the network)
function chuteView( scene ) {

	let c = null;
	try {

		c = new Chute( { position: new Vector3(), heading: 0, scene } );

	} catch ( e ) { c = null; }

	return {
		setPose( p, yaw, open ) {

			if ( ! c ) return;
			c.position.copy( p );
			c.yaw = yaw;
			c.state = open > 0 ? 'open' : 'free';
			c.open01 = Math.min( 1, Math.max( 0, open ) );
			c.quaternion.setFromAxisAngle( _Y, yaw );
			if ( c._sync ) c._sync();

		},
		dispose() {

			if ( c ) c.dispose();
			c = null;

		},
	};

}

export class PlaneLink {

	constructor( sync ) {

		this.sync = sync;
		this.remote = new Map();
		this.chutes = new Map();
		this.stats = { out: 0, dels: 0, added: 0, removed: 0, chutes: 0, fed: 0 };
		this.time = 0;
		this._sent = new Map(); // id -> { sig, at }
		this._fed = new Map(); // peer id -> the lastAt of the state fed to seaplane.updateRemote
		this._room = null;
		this._seen = new Set();

	}

	get features() {

		return this.sync.features;

	}

	_sp() {

		const f = this.features;
		return f && f.get ? f.get( 'seaplane' ) : null;

	}

	_state() {

		const net = this.sync.net, room = net && net.link ? net.link.room : null;
		return room && room.state && room.state.planes ? room.state : null;

	}

	get supported() {

		return !! this._state();

	}

	bind() {

		this.clear();
		this._sent.clear();
		this._fed.clear();
		this._room = null;

	}

	clear() {

		for ( const v of this.remote.values() ) this._unrender( v );
		this.remote.clear();
		for ( const c of this.chutes.values() ) c.view.dispose();
		this.chutes.clear();

	}

	// ------------------------------------------------------------------ the local player's state

	decorate( s ) {

		if ( ! s ) return s;
		if ( s.mode === 'plane' ) {

			// seated in the cockpit / the harness (Player.pose): the avatar sits where p says
			s.mode = 'seat';
			s.action = 'seated';
			s.speed = 0;
			s.vy = 0;
			s.grounded = true;
			s.diving = false;

		}

		const sp = this._sp();
		if ( ! sp ) return s;
		if ( s.plane && typeof s.plane === 'object' ) s.plane.up = upgradeCode( sp.upgrades );
		const c = sp.chute;
		if ( c && c.position && c.state !== 'landed' && [ c.position.x, c.position.y, c.position.z, c.yaw ].every( Number.isFinite ) ) {

			s.chute = [ r2( c.position.x ), r2( c.position.y ), r2( c.position.z ), r3( wrap( c.yaw ) ), r2( c.state === 'open' ? Math.max( 0.05, c.open01 || 0 ) : 0 ) ];
			s.yaw = wrap( c.yaw + Math.PI ); // (Player yaw 0 faces -Z: facing the drift)

		}

		return s;

	}

	// ------------------------------------------------------------------ the others' flying planes

	feed( rp ) {

		const sp = this._sp();
		if ( ! sp || ! rp || ! rp.peers ) return;
		const fresh = [];
		for ( const [ id, p ] of rp.peers ) {

			const pl = p.extra && p.extra.plane;
			if ( pl && typeof pl === 'object' ) {

				if ( this._fed.get( id ) === p.lastAt ) continue;
				this._fed.set( id, p.lastAt );
				fresh.push( { id, plane: pl } );

			} else if ( this._fed.has( id ) ) {

				this._fed.delete( id );
				this._dropFlying( sp, id );

			}

		}

		for ( const id of [ ...this._fed.keys() ] ) if ( ! rp.peers.has( id ) ) {

			this._fed.delete( id );
			this._dropFlying( sp, id );

		}

		if ( fresh.length && typeof sp.updateRemote === 'function' ) {

			this.stats.fed += fresh.length;
			try { sp.updateRemote( fresh ); } catch ( e ) { /* a remote plane is decoration */ }

		}

	}

	_dropFlying( sp, id ) {

		const peers = sp.remote && sp.remote.peers;
		const r = peers && peers.get ? peers.get( id ) : null;
		if ( ! r ) return;
		if ( r.visual && r.visual.dispose ) try { r.visual.dispose(); } catch ( e ) { /* gone */ }
		peers.delete( id );

	}

	// ------------------------------------------------------------------ chutes

	_chutes( rp ) {

		const seen = this._seen;
		seen.clear();
		if ( rp && rp.peers ) for ( const [ id, p ] of rp.peers ) {

			const c = p.extra && p.extra.chute;
			if ( ! fin( c, 5 ) ) continue;
			seen.add( id );
			let v = this.chutes.get( id );
			if ( ! v ) {

				const make = this.sync.opts && this.sync.opts.chuteVisual;
				v = { id, view: make ? make( id ) : chuteView( this.sync.app.scene || null ), at: [ 0, 0, 0 ] };
				this.chutes.set( id, v );
				this.stats.chutes ++;

			}

			// the harness rides the interpolated avatar (else the state's own point)
			if ( p.hasPose && p.pose && p.pose.position ) _p.copy( p.pose.position );
			else _p.set( c[ 0 ], c[ 1 ], c[ 2 ] );
			v.at = [ _p.x, _p.y, _p.z ];
			v.yaw = c[ 3 ];
			v.open = c[ 4 ];
			v.view.setPose( _p, c[ 3 ], c[ 4 ] );

		}

		for ( const [ id, v ] of this.chutes ) {

			if ( seen.has( id ) ) continue;
			v.view.dispose();
			this.chutes.delete( id );

		}

	}

	// ------------------------------------------------------------------ out: the entries this player owns

	local() {

		const sp = this._sp(), out = [];
		const f = sp && sp.flight;
		if ( ! f || ! f.position || ! f.quaternion ) return out;
		const P = f.position, Q = f.quaternion;
		if ( ! [ P.x, P.y, P.z, Q.x, Q.y, Q.z, Q.w ].every( Number.isFinite ) ) return out;
		const base = {
			af: typeof sp.af === 'string' ? sp.af : 'jade', liv: ( sp.upgrades && sp.upgrades.livery ) | 0, up: upgradeCode( sp.upgrades ),
			p: [ r2( P.x ), r2( P.y ), r2( P.z ) ], q: [ r4( Q.x ), r4( Q.y ), r4( Q.z ), r4( Q.w ) ],
		};
		if ( sp.lost ) return out; // (a wreck: WreckLink's entry)
		if ( sp.abandoned ) out.push( { id: 'stray', kind: 'stray', ...base, thr: r2( Math.max( 0, Math.min( 2, f.rpm || 0 ) ) ) } );
		else if ( ! sp.piloted ) {

			const owned = typeof sp.owns === 'function' ? sp.owns( base.af ) : sp.owned;
			if ( owned ) out.push( { id: 'parked', kind: 'parked', ...base, thr: 0 } );

		}

		return out;

	}

	_same( e, w ) {

		if ( e.kind !== w.kind || e.af !== w.af || ( e.liv | 0 ) !== w.liv || e.up !== w.up ) return false;
		const move = w.kind === 'stray' ? PLANE_SYNC.move : PLANE_SYNC.parkMove, turn = w.kind === 'stray' ? PLANE_SYNC.turn : PLANE_SYNC.parkTurn;
		if ( Math.abs( e.x - w.p[ 0 ] ) > move || Math.abs( e.y - w.p[ 1 ] ) > move || Math.abs( e.z - w.p[ 2 ] ) > move ) return false;
		const dot = Math.abs( e.qx * w.q[ 0 ] + e.qy * w.q[ 1 ] + e.qz * w.q[ 2 ] + e.qw * w.q[ 3 ] );
		return 1 - dot <= turn;

	}

	_out( st, net ) {

		const mine = new Map(), pre = net.id + ':';
		st.planes.forEach( ( e, key ) => { if ( e.owner === net.id && key.startsWith( pre ) ) mine.set( key.slice( pre.length ), e ); } );
		const keep = new Set();
		for ( const w of this.local() ) {

			keep.add( w.id );
			const last = this._sent.get( w.id );
			if ( last && this.time - last.at < ( w.kind === 'stray' ? PLANE_SYNC.stray : PLANE_SYNC.parked ) - 1e-6 ) continue;
			const cur = mine.get( w.id );
			if ( cur && this._same( cur, w ) ) continue;
			const sig = JSON.stringify( w );
			if ( last && last.sig === sig && this.time - last.at < PLANE_SYNC.resend ) continue; // (on its way)
			if ( net.sendMsg( { t: 'plane', op: 'set', ...w } ) ) {

				this._sent.set( w.id, { sig, at: this.time } );
				this.stats.out ++;

			}

		}

		for ( const id of mine.keys() ) {

			if ( keep.has( id ) ) continue;
			const last = this._sent.get( 'del:' + id );
			if ( last && this.time - last.at < PLANE_SYNC.resend ) continue;
			if ( net.sendMsg( { t: 'plane', op: 'del', id } ) ) {

				this._sent.set( 'del:' + id, { at: this.time } );
				this._sent.delete( id );
				this.stats.dels ++;

			}

		}

	}

	// ------------------------------------------------------------------ in: the others' entries

	_visual( v ) {

		const sp = this._sp(), make = this.sync.opts && this.sync.opts.planeVisual;
		try {

			return make ? make( { key: v.key, kind: v.kind, af: v.af, liv: v.liv, model: v.af } ) : sp && v.kind === 'parked' && sp.parkedVisual ? sp.parkedVisual( v.af, v.liv ) : sp && sp.models && sp.models.create ? sp.models.create( v.af, v.liv ) : null;

		} catch ( e ) {

			return null;

		}

	}

	_in( st, net, dt ) {

		const seen = new Set(), t = now(), sp = this._sp();
		st.planes.forEach( ( e, key ) => {

			if ( ! e || e.owner === net.id ) return;
			seen.add( key );
			let v = this.remote.get( key );
			if ( v && ( v.af !== e.af || v.liv !== ( e.liv | 0 ) ) ) {

				// a new airframe or another paint: a new model
				if ( v.visual && v.visual.dispose ) v.visual.dispose();
				v.af = e.af;
				v.liv = e.liv | 0;
				v.visual = this._visual( v );

			}

			if ( ! v ) {

				v = { key, owner: e.owner, kind: e.kind, af: e.af, liv: e.liv | 0, up: e.up, visual: null, snaps: [], sig: '', cur: null };
				v.visual = this._visual( v );
				this.remote.set( key, v );
				this.stats.added ++;

			}

			v.kind = e.kind;
			v.up = e.up;
			const sig = `${ r2( e.x ) }|${ r2( e.y ) }|${ r2( e.z ) }|${ r4( e.qx ) }|${ r4( e.qy ) }|${ r4( e.qz ) }|${ r4( e.qw ) }|${ r2( e.thr ) }`;
			if ( sig !== v.sig ) {

				v.sig = sig;
				v.snaps.push( { t, p: [ e.x, e.y, e.z ], q: [ e.qx, e.qy, e.qz, e.qw ], thr: e.thr } );
				if ( v.snaps.length > PLANE_SYNC.keep ) v.snaps.shift();

			}

		} );
		for ( const [ key, v ] of this.remote ) {

			if ( seen.has( key ) ) continue;
			this._unrender( v );
			this.remote.delete( key );
			this.stats.removed ++;

		}

		const flying = sp && sp.remote && sp.remote.peers;
		for ( const v of this.remote.values() ) this._draw( v, dt, t, !! ( v.kind === 'parked' && flying && flying.has && flying.has( v.owner ) ) );

	}

	// the pose of an entry: a stray INTERP behind its newest sample, a parked one eased to its spot
	pose( v, t = now() ) {

		const s = v.snaps;
		if ( ! s.length ) return null;
		if ( v.kind === 'parked' ) {

			const last = s[ s.length - 1 ];
			return { position: _p.set( last.p[ 0 ], last.p[ 1 ], last.p[ 2 ] ), quaternion: _q.set( last.q[ 0 ], last.q[ 1 ], last.q[ 2 ], last.q[ 3 ] ).normalize(), thr: 0 };

		}

		const rt = t - PLANE_SYNC.interp;
		let a = s[ 0 ], b = s[ 0 ], k = 0;
		for ( let i = s.length - 1; i > 0; i -- ) {

			if ( s[ i - 1 ].t <= rt ) {

				a = s[ i - 1 ];
				b = s[ i ];
				k = b.t > a.t ? Math.min( 1, Math.max( 0, ( rt - a.t ) / ( b.t - a.t ) ) ) : 1;
				break;

			}

		}

		if ( rt >= s[ s.length - 1 ].t ) a = b = s[ s.length - 1 ];
		_p.set( a.p[ 0 ] + ( b.p[ 0 ] - a.p[ 0 ] ) * k, a.p[ 1 ] + ( b.p[ 1 ] - a.p[ 1 ] ) * k, a.p[ 2 ] + ( b.p[ 2 ] - a.p[ 2 ] ) * k );
		_q.set( a.q[ 0 ], a.q[ 1 ], a.q[ 2 ], a.q[ 3 ] ).normalize();
		if ( a !== b ) _q.slerp( _q2.set( b.q[ 0 ], b.q[ 1 ], b.q[ 2 ], b.q[ 3 ] ).normalize(), k );
		return { position: _p, quaternion: _q, thr: a.thr + ( b.thr - a.thr ) * k };

	}

	_draw( v, dt, t, hidden ) {

		const vis = v.visual;
		if ( ! vis ) return;
		if ( vis.setVisible ) vis.setVisible( ! hidden );
		if ( hidden ) return;
		const s = this.pose( v, t );
		if ( ! s ) return;
		if ( ! v.cur ) v.cur = { p: s.position.clone(), q: s.quaternion.clone() };
		else if ( v.kind === 'parked' ) {

			// a parked plane that moved (towed home, taken out) eases there
			const k = 1 - Math.exp( - dt * PLANE_SYNC.ease );
			v.cur.p.lerp( s.position, k );
			v.cur.q.slerp( s.quaternion, k );

		} else {

			v.cur.p.copy( s.position );
			v.cur.q.copy( s.quaternion );

		}
		if ( vis.setPose ) vis.setPose( v.cur.p, v.cur.q );
		if ( vis.spin ) vis.spin( dt, v.kind === 'stray' ? Math.max( 0.08, s.thr ) : 0 );

	}

	_unrender( v ) {

		if ( v.visual && v.visual.dispose ) try { v.visual.dispose(); } catch ( e ) { /* gone */ }
		v.visual = null;

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		this.time += dt;
		const net = this.sync.net, rp = this.sync.app.remotePlayers;
		const room = net && net.link ? net.link.room : null;
		if ( room && room !== this._room ) {

			if ( this._room ) this.clear();
			this._room = room;
			this._sent.clear();

		}

		if ( ! net || ! net.online ) return;
		this.feed( rp );
		this._chutes( rp );
		const st = this._state();
		if ( ! st ) return;
		this._out( st, net );
		this._in( st, net, dt );

	}

	dispose() {

		this.clear();
		this._sent.clear();
		this._fed.clear();

	}

}
