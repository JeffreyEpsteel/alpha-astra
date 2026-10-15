// Wrecks everybody sees (wave 11): a player's boat going down, her wreck on the sea floor and a seaplane wreck are compact
// entries of the room's schema state (server/schema.mjs Wreck: owner, kind, model, x, y, z, yaw, pitch, roll, t, parts), so a
// late joiner and a reconnected client see them too.
//
//   owner   every WRECK_SYNC.every s the local wrecks (naval.sinking, naval.wrecks.own, seaplane.wreck) are compared with this
//           player's entries in the state and the differences sent ({ t: 'wreck', op: 'add' | 'del' }): a salvage, a recovery,
//           a plane that went under, a sinking that became a wreck all remove / replace their entry; a new room (crew change,
//           restart) gets them again. The naval feature's own 'wreck' / 'wreckSalvaged' world events stay home
//           (NetSync.sendWorldEvent: the schema carries them).
//   others  each entry is drawn by the owning feature's own code in a passive mode:
//             'boat'     naval Wrecks (the remoteWorldEvent 'wreck' / 'wreckSalvaged' it already handles: the hull on the floor)
//             'sinking'  naval's breaking-up show at the spot (Naval._wreckage: debris, splinters, Planks) and vfx.sinking
//             'plane'    a seaplane Wreck (Wreck.js) + PlaneVisual (seaplane.models.create()): the fuselage follows the entry,
//                        the torn-off parts (the `parts` bits, PART_NAMES order) fly, float and sink like the owner's
//           and removed when the entry goes.
//
//   const wl = new WreckLink( sync );  wl.bind( net );  wl.update( dt );  wl.supported;  wl.remote (Map key -> view)
//   wl.local() -> the entries this player owns now;  wl.stats { out, dels, added, removed }
// Wave 13: a plane wreck's model names its airframe and livery ('kestrel', 'petrel-2'; 'seaplane' from older clients is the
// Jade): the remote wreck is that airframe's model in that paint, its pieces where that airframe has them (Wreck partsFor).

// a plane wreck entry's model -> { af, liv }
export function planeModelOf( model ) {

	const m = /^([a-z]+)(?:-(\d{1,2}))?$/.exec( String( model || '' ) );
	const af = m && m[ 1 ] !== 'seaplane' ? m[ 1 ] : 'jade';
	return { af, liv: m && m[ 2 ] ? + m[ 2 ] : 0 };

}

import { Vector3, Quaternion } from '../../engine/index.js';
import { BOATS } from '../../game/Boats.js';
import { Wreck as PlaneWreck, PART_NAMES, partsFor } from '../seaplane/Wreck.js';

export const WRECK_SYNC = {
	every: 0.5, // s between two comparisons of the local wrecks with the room's entries
	resend: 2, // s before an unanswered add / del goes again
	move: 0.4, // m a plane wreck drifts before its entry follows
	turn: 0.06, // rad
	follow: 3, // 1/s: a remote plane's fuselage eases to its entry
	fresh: 12, // s: a 'sinking' entry older than this (a late joiner) shows no breaking-up
	catchUp: 30, // s of a remote plane wreck's pieces simulated at once when it is first seen late
};
export const SINKING_BIT = 1 << 7; // a seaplane's fuselage is going down

const _X = new Vector3( 1, 0, 0 ), _Y = new Vector3( 0, 1, 0 ), _Z = new Vector3( 0, 0, 1 );
const _qa = new Quaternion(), _qb = new Quaternion(), _qc = new Quaternion(), _p = new Vector3(), _q = new Quaternion();
const wrap = ( a ) => ( ( a + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI;
const r1 = ( v ) => Math.round( v * 10 ) / 10;
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const r3 = ( v ) => Math.round( v * 1000 ) / 1000;

// heading, nose-down pitch and list of a quaternion (YXZ: q = yaw about Y * pitch about X * roll about Z) and back
export function anglesOf( q, out = {} ) {

	const fx = 2 * ( q.x * q.z + q.w * q.y ), fy = 2 * ( q.y * q.z - q.w * q.x ), fz = 1 - 2 * ( q.x * q.x + q.y * q.y );
	out.yaw = Math.atan2( fx, fz );
	out.pitch = Math.asin( Math.max( - 1, Math.min( 1, - fy ) ) );
	_qa.setFromAxisAngle( _Y, out.yaw ).multiply( _qb.setFromAxisAngle( _X, out.pitch ) ).invert().multiply( _qc.copy( q ) );
	out.roll = wrap( 2 * Math.atan2( _qa.z, _qa.w ) );
	return out;

}

export function quatOf( yaw, pitch, roll, out = new Quaternion() ) {

	return out.setFromAxisAngle( _Y, yaw ).multiply( _qb.setFromAxisAngle( _X, pitch ) ).multiply( _qc.setFromAxisAngle( _Z, roll ) );

}

// the parts bitmask of a seaplane wreck: bit i = PART_NAMES[ i ] torn off; SINKING_BIT while the fuselage goes down
export function planeBits( w ) {

	let bits = 0;
	PART_NAMES.forEach( ( n, i ) => { if ( w.detached && w.detached.has( n ) ) bits |= 1 << i; } );
	if ( w.fuselage && w.fuselage.state === 'sinking' ) bits |= SINKING_BIT;
	return bits;

}

const hashOf = ( s ) => {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return ( h >>> 0 ) || 1;

};

const cleanId = ( id, d ) => String( id || '' ).replace( /[^\w.-]/g, '' ).slice( 0, 24 ) || d;

// a remote seaplane wreck: the owner's pieces re-enacted (seeded per entry) with the fuselage pinned to the entry
export class PlaneWreckView {

	constructor( entry, { visual = null, seaAt = null, groundAt = null, age = 0, vfx = null } = {} ) {

		this.visual = visual;
		this.vfx = vfx;
		const q = quatOf( entry.yaw, entry.pitch, entry.roll );
		const c = new Vector3( entry.x, entry.y, entry.z );
		const { af } = planeModelOf( entry.model );
		// Wreck takes the plane's pose: its origin is the fuselage centre less the model-frame centre (of that airframe)
		const origin = new Vector3( ...partsFor( af ).fuselage.c ).applyQuaternion( q ).multiplyScalar( - 1 ).add( c );
		this.wreck = new PlaneWreck( { position: origin, quaternion: q, seed: hashOf( entry.key || 'plane' ), afloat: 1e9, airframe: af } );
		this.target = { c: c.clone(), q: q.clone() };
		this.cur = { c: c.clone(), q: q.clone() }; // (eased towards the target; the pieces' own physics never move the fuselage)
		this.env = { seaAt: seaAt || ( () => 0 ), groundAt: groundAt || ( () => - Infinity ) };
		this.bits = 0;
		this._tear( entry.parts );
		// first seen late: the pieces have flown and settled already
		for ( let t = Math.min( Math.max( 0, age ), WRECK_SYNC.catchUp ); t > 0; t -= 0.1 ) this._step( 0.1, true );
		this.sync();

	}

	_tear( bits ) {

		const add = ( bits & ~ this.bits ) & ( ( 1 << PART_NAMES.length ) - 1 );
		this.bits = bits;
		PART_NAMES.forEach( ( n, i ) => {

			if ( ! ( add & ( 1 << i ) ) || n === 'fuselage' ) return;
			this.wreck.detach( n );
			if ( this.visual && this.visual.detach ) this.visual.detach( n );

		} );

	}

	retarget( entry ) {

		this.target.c.set( entry.x, entry.y, entry.z );
		quatOf( entry.yaw, entry.pitch, entry.roll, this.target.q );
		this._tear( entry.parts );

	}

	_step( dt, quiet ) {

		const events = this.wreck.update( dt, this.env );
		const f = this.wreck.fuselage, k = 1 - Math.exp( - dt * WRECK_SYNC.follow );
		f.c.copy( this.cur.c.lerp( this.target.c, k ) );
		f.q.copy( this.cur.q.slerp( this.target.q, k ) );
		f.v.set( 0, 0, 0 );
		f.w.set( 0, 0, 0 );
		if ( f.state === 'flying' ) f.state = 'afloat'; // (the owner's entry says where she is)
		if ( quiet || ! this.vfx ) return;
		for ( const e of events ) {

			if ( e.type === 'splash' && this.vfx.splash ) this.vfx.splash( e.x, e.y, e.z, e.strength || 0.6 );
			else if ( e.type === 'land' && this.vfx.dust ) this.vfx.dust( e.x, e.y, e.z, e.strength || 0.6 );

		}

	}

	update( dt ) {

		this._step( Math.min( dt, 0.1 ), false );
		this.sync();

	}

	// the visual from the pieces (as Seaplane._syncWreck does for the owner's)
	sync() {

		const w = this.wreck, v = this.visual;
		if ( ! v ) return;
		if ( w.pose( 'fuselage', _p, _q ) && v.setPose ) v.setPose( _p, _q );
		if ( v.setVisible ) v.setVisible( true );
		for ( const n of w.detached ) {

			const on = w.pose( n, _p, _q );
			if ( v.setPart ) v.setPart( n, _p, _q );
			if ( v.partVisible ) v.partVisible( n, on );

		}

	}

	dispose() {

		if ( this.visual && this.visual.dispose ) try { this.visual.dispose(); } catch ( e ) { /* gone */ }
		this.visual = null;

	}

}

export class WreckLink {

	constructor( sync ) {

		this.sync = sync;
		this.remote = new Map(); // entry key -> { key, kind, sig, entry, view }
		this.stats = { out: 0, dels: 0, added: 0, removed: 0 };
		this.time = 0;
		this._acc = 0;
		this._sent = new Map(); // id -> { sig, at } of an add / del on its way
		this._room = null;
		this._seen = new Set();

	}

	get features() {

		return this.sync.features;

	}

	_get( name ) {

		const f = this.features;
		return f && f.get ? f.get( name ) : null;

	}

	_state() {

		const net = this.sync.net, room = net && net.link ? net.link.room : null;
		return room && room.state && room.state.wrecks ? room.state : null;

	}

	// the server keeps wrecks in its state (a 2.x server does not: the world events are relayed instead)
	get supported() {

		return !! this._state();

	}

	bind( net ) {

		this.clear();
		this._sent.clear();
		this._room = null;
		this._acc = 0;

	}

	clear() {

		for ( const v of this.remote.values() ) this._unrender( v );
		this.remote.clear();

	}

	// ------------------------------------------------------------------ out

	// the wrecks this player owns now, as entries
	local() {

		const out = [];
		const n = this._get( 'naval' ), sp = this._get( 'seaplane' );
		if ( n ) {

			const s = n.sinking;
			if ( s && BOATS[ s.boat ] && [ s.x, s.y, s.z ].every( Number.isFinite ) ) {

				out.push( { id: 'sinking', kind: 'sinking', model: s.boat, x: r2( s.x ), y: r2( s.y ), z: r2( s.z ), yaw: r3( s.yaw || 0 ), pitch: 0, roll: s.list < 0 ? - 1 : 1, parts: 0 } );

			}

			const w = n.wrecks && n.wrecks.own;
			if ( w && BOATS[ w.boat ] && [ w.x, w.y, w.z ].every( Number.isFinite ) ) {

				out.push( { id: cleanId( w.id, 'boat' ), kind: 'boat', model: w.boat, x: r2( w.x ), y: r2( w.y ), z: r2( w.z ), yaw: r3( w.yaw || 0 ), pitch: r3( w.pitch || 0 ), roll: r3( w.roll || 0 ), parts: 0 } );

			}

		}

		const w = sp ? sp.wreck : null; // (Seaplane: the pieces while the fuselage is still up)
		if ( w && w.fuselage && [ w.x, w.y, w.z ].every( Number.isFinite ) ) {

			const a = anglesOf( w.fuselage.q );
			const af = typeof w.airframe === 'string' && /^[a-z]{2,16}$/.test( w.airframe ) ? w.airframe : typeof sp.af === 'string' ? sp.af : 'jade';
			const liv = ( sp.upgrades && sp.upgrades.livery ) | 0;
			out.push( { id: 'plane', kind: 'plane', model: liv > 0 ? `${ af }-${ liv }` : af, x: r2( w.x ), y: r2( w.y ), z: r2( w.z ), yaw: r3( a.yaw ), pitch: r3( a.pitch ), roll: r3( a.roll ), parts: planeBits( w ) } );

		}

		return out;

	}

	_same( e, w ) {

		return e.kind === w.kind && e.model === w.model && ( e.parts | 0 ) === w.parts
			&& Math.abs( e.x - w.x ) <= WRECK_SYNC.move && Math.abs( e.y - w.y ) <= WRECK_SYNC.move && Math.abs( e.z - w.z ) <= WRECK_SYNC.move
			&& Math.abs( wrap( e.yaw - w.yaw ) ) <= WRECK_SYNC.turn && Math.abs( wrap( e.pitch - w.pitch ) ) <= WRECK_SYNC.turn && Math.abs( wrap( e.roll - w.roll ) ) <= WRECK_SYNC.turn;

	}

	_out( st, net ) {

		const mine = new Map(), pre = net.id + ':';
		st.wrecks.forEach( ( e, key ) => { if ( e.owner === net.id && key.startsWith( pre ) ) mine.set( key.slice( pre.length ), e ); } );
		const keep = new Set();
		for ( const w of this.local() ) {

			keep.add( w.id );
			const cur = mine.get( w.id );
			if ( cur && this._same( cur, w ) ) {

				this._sent.delete( w.id );
				continue;

			}

			const sig = JSON.stringify( w ), last = this._sent.get( w.id );
			if ( last && last.sig === sig && this.time - last.at < WRECK_SYNC.resend ) continue; // (on its way)
			if ( net.sendMsg( { t: 'wreck', op: 'add', ...w } ) ) {

				this._sent.set( w.id, { sig, at: this.time } );
				this.stats.out ++;

			}

		}

		for ( const id of mine.keys() ) {

			if ( keep.has( id ) ) continue;
			const last = this._sent.get( 'del:' + id );
			if ( last && this.time - last.at < WRECK_SYNC.resend ) continue;
			if ( net.sendMsg( { t: 'wreck', op: 'del', id } ) ) {

				this._sent.set( 'del:' + id, { at: this.time } );
				this.stats.dels ++;

			}

		}

	}

	// ------------------------------------------------------------------ in

	_in( st, net, dt ) {

		const seen = this._seen;
		seen.clear();
		st.wrecks.forEach( ( e, key ) => {

			if ( ! e || e.owner === net.id ) return;
			seen.add( key );
			const entry = {
				key, owner: e.owner, kind: e.kind, model: e.model, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, roll: e.roll, t: e.t, parts: e.parts | 0,
			};
			const sig = `${ e.kind }|${ e.model }|${ entry.parts }|${ r1( e.x ) }|${ r1( e.y ) }|${ r1( e.z ) }|${ r2( e.yaw ) }|${ r2( e.pitch ) }|${ r2( e.roll ) }`;
			let v = this.remote.get( key );
			if ( v && v.sig === sig ) return;
			if ( v && v.kind !== entry.kind ) {

				this._unrender( v );
				v = null;

			}

			if ( ! v ) {

				v = { key, kind: entry.kind, sig, entry, view: null };
				this.remote.set( key, v );
				this.stats.added ++;
				this._render( v, true );

			} else {

				v.sig = sig;
				v.entry = entry;
				this._render( v, false );

			}

		} );
		for ( const [ key, v ] of this.remote ) {

			if ( seen.has( key ) ) continue;
			this._unrender( v );
			this.remote.delete( key );
			this.stats.removed ++;

		}

		for ( const v of this.remote.values() ) if ( v.view && v.view.update ) v.view.update( dt );

	}

	// seconds since the server added an entry (the clock offset from NetClient's pongs, when it has one)
	_age( entry ) {

		const net = this.sync.net, off = net && Number.isFinite( net.serverOffset ) ? net.serverOffset : 0;
		return entry.t > 0 ? Math.max( 0, ( Date.now() - off - entry.t ) / 1000 ) : 0;

	}

	_render( v, fresh ) {

		const e = v.entry;
		if ( e.kind === 'boat' ) {

			// naval Wrecks draws it like a world event wreck (a changed entry replaces the mesh)
			this._emit( 'remoteWorldEvent', {
				kind: 'wreck', from: e.owner, at: Date.now(), replay: false, schema: true,
				data: { id: e.key, boat: e.model, name: ( BOATS[ e.model ] && BOATS[ e.model ].name ) || 'boat', x: e.x, y: e.y, z: e.z, yaw: e.yaw, roll: e.roll, pitch: e.pitch },
			} );

		} else if ( e.kind === 'sinking' ) {

			if ( fresh && this._age( e ) < WRECK_SYNC.fresh ) this._sinkFx( e );

		} else if ( e.kind === 'plane' ) {

			if ( fresh ) v.view = this._planeView( e );
			else if ( v.view ) v.view.retarget( e );

		}

	}

	_unrender( v ) {

		if ( v.kind === 'boat' ) this._emit( 'remoteWorldEvent', { kind: 'wreckSalvaged', from: v.entry.owner, at: Date.now(), replay: false, schema: true, data: { id: v.key } } );
		if ( v.view ) v.view.dispose();
		v.view = null;

	}

	// a remote boat breaking up and going down: naval's own show (debris, splinters, Planks) and the vfx bubbles and foam
	_sinkFx( e ) {

		const n = this._get( 'naval' ), vfx = this._get( 'vfx' ), b = BOATS[ e.model ] || {};
		const len = b.length || 6, beam = b.beam || 2.5;
		if ( n && typeof n._wreckage === 'function' ) {

			try { n._wreckage( e.x, e.y + ( b.freeboard || 0.6 ), e.z, len, beam, e.yaw ); } catch ( err ) { /* decoration */ }

		} else if ( n && n.planks && n.planks.burst ) n.planks.burst( e.x, e.z, 6, Math.max( 2, len * 0.3 ) );
		if ( vfx && vfx.sinking ) vfx.sinking( 'net-' + e.key, e.x, e.z, Math.max( 1, len / 8 ) );

	}

	_planeView( e ) {

		const app = this.sync.app, sp = this._get( 'seaplane' ), make = this.sync.opts && this.sync.opts.planeVisual;
		let visual = null;
		try {

			const { af, liv } = planeModelOf( e.model );
			visual = make ? make( e ) : sp && sp.models && sp.models.create ? sp.models.create( af, liv ) : null;

		} catch ( err ) { /* no model: the pieces still run (nothing drawn) */ }

		const T = app.terrainData;
		return new PlaneWreckView( e, {
			visual, age: this._age( e ), vfx: this._get( 'vfx' ),
			groundAt: T && T.heightAt ? ( x, z ) => T.heightAt( x, z ) : null,
		} );

	}

	_emit( type, payload ) {

		if ( this.sync._emit ) this.sync._emit( type, payload );

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		this.time += dt;
		const net = this.sync.net;
		const room = net && net.link ? net.link.room : null;
		if ( room && room !== this._room ) {

			// a new room (a crew change, a fresh join after the server restarted): its own entries, ours sent again
			if ( this._room ) this.clear();
			this._room = room;
			this._sent.clear();
			this._acc = WRECK_SYNC.every;

		}

		if ( ! net || ! net.online ) return; // (a dropped link keeps what it shows: the state comes back reconciled)
		const st = this._state();
		if ( ! st ) return;
		this._acc += dt;
		if ( this._acc >= WRECK_SYNC.every ) {

			this._acc = 0;
			this._out( st, net );

		}

		this._in( st, net, dt );

	}

	dispose() {

		this.clear();
		this._sent.clear();

	}

}
