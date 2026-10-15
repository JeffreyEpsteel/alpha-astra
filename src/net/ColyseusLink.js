// One connection to a Hyptile Island room on the Colyseus server (@colyseus/sdk 0.18), spoken as the message vocabulary of
// src/net/Protocol.js. NetClient, the universe probe and the tests sit on this; nothing above it knows about Colyseus.
//
//   const link = new ColyseusLink( { url, onMessage( m ), onDrop( { code } ), onReconnect(), onClose( { code, kick } ) } );
//   await link.join( hello )               hello = Protocol.helloMessage (+ token / probe for a universe)
//   link.send( { t, ...body } )            a message; link.sendRaw( type, payload ) (a save goes as JSON text)
//   link.leave()                           a goodbye (the server forgets the seat); link.drop() closes like a lost network
//   link.id, link.room, link.open, link.dropped
//
// url: ws(s)://host:port[/prefix]/<room>. The endpoint is everything before the last path segment (a TLS proxy may put the
// server under a prefix); the segment picks the room: 'universe' (joinById), a crew code (joinById), else a named room
// (joinOrCreate 'room', filtered by name). join() rejects with an Error whose .code is a refusal name (Protocol.REFUSAL:
// 'full', 'name', 'banned', 'nocrew'...) or 'down' / 'timeout' when nobody answers, and .text the server's words.
//
// A dropped socket is the SDK's business: it retries on the same Room (room.onDrop / room.onReconnect; the server's
// allowReconnection keeps the seat RECONNECT_SECONDS). onDrop / onReconnect are passed up; onClose fires only when the room
// is really gone (a goodbye, a kick, a server shutdown, or CloseCode.FAILED_TO_RECONNECT).
//
// The room's schema state becomes messages: the first full state + the server's 'welcome' make { t: 'welcome', ..., peers }
// (each peer with its newest state); then Callbacks.get( room ) onAdd / onRemove on `players` give 'join' / 'leave', a
// listen on `host` gives 'host', and each patch (onStateChange) gives 'states' (the players whose `seq` moved, at = the
// server's time), a profile 'join' (`profile` moved), 'clock' and 'world' (the host's ships, to everybody but the host).
// All other server messages pass through as { t: type, ...body }. After a reconnect the server sends its welcome again
// and the peers are rebuilt from it.

import { Client, Callbacks, ErrorCode } from '@colyseus/sdk';
import { sanitizeRoom, isCrewRoom, REFUSAL_OF, REFUSAL_HTTP, KICK_CLOSE, UNIVERSE_PATH, RECONNECT_SECONDS } from './Protocol.js';

const JOIN_TIMEOUT = 10000;
const r1 = ( v ) => Math.round( v * 10 ) / 10;
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const r4 = ( v ) => Math.round( v * 1e4 ) / 1e4;
const BAD_KEYS = new Set( [ '__proto__', 'constructor', 'prototype' ] );

// the numeric code of an SDK failure (MatchMakeError / ServerError), or 0 (no answer at all)
function errorCode( e ) {

	if ( ! e ) return 0;
	if ( typeof e.code === 'number' ) return e.code;
	if ( e.data && typeof e.data.code === 'number' ) return e.data.code;
	return 0;

}

// where to connect and which room: { endpoint, room, kind: 'universe' | 'crew' | 'room' } or null for a malformed url
export function linkTarget( url ) {

	try {

		const u = new URL( url );
		if ( ! /^wss?:$/.test( u.protocol ) ) return null;
		const segs = u.pathname.split( '/' ).filter( Boolean );
		const last = segs.length ? segs.pop() : '';
		const room = sanitizeRoom( last );
		const prefix = segs.length ? '/' + segs.join( '/' ) : '';
		const kind = room === UNIVERSE_PATH ? 'universe' : isCrewRoom( room ) ? 'crew' : 'room';
		const http = u.protocol === 'wss:' ? 'https:' : 'http:'; // (the SDK takes the http address and opens ws(s) itself)
		return { endpoint: `${ http }//${ u.host }${ prefix }`, room, kind };

	} catch ( e ) {

		return null;

	}

}

// a schema Player as the Protocol state object
export function playerState( pl ) {

	const s = {
		ride: pl.ride || null, seat: pl.seat | 0,
		p: [ r2( pl.x ), r2( pl.y ), r2( pl.z ) ], yaw: r2( pl.yaw ), mode: pl.mode || 'walk', speed: r2( pl.speed ), vy: r2( pl.vy ),
		grounded: pl.grounded !== false, diving: pl.diving === true, action: pl.action || null, character: pl.character || null, boat: null,
	};
	const b = pl.boat;
	if ( b && b.id ) {

		s.boat = {
			id: b.id, p: [ r2( b.x ), r2( b.y ), r2( b.z ) ], q: [ r4( b.qx ), r4( b.qy ), r4( b.qz ), r4( b.qw ) ],
			throttle: r2( b.throttle ), steer: r2( b.steer ), rpm: Math.round( b.rpm ), driven: b.driven === true,
		};

	}

	if ( pl.extra ) {

		try {

			const x = JSON.parse( pl.extra );
			if ( x && typeof x === 'object' ) for ( const k of Object.keys( x ) ) if ( ! BAD_KEYS.has( k ) && ! ( k in s ) ) s[ k ] = x[ k ];

		} catch ( e ) { /* a broken extra is dropped */ }

	}

	return s;

}

export function peerOf( pl ) {

	const p = { id: pl.id, name: pl.name, character: pl.character, boat: pl.owned || null, open: pl.open !== false };
	if ( pl.captain ) p.captain = pl.captain;
	return p;

}

export function shipsOf( arr ) {

	const out = [];
	if ( arr ) for ( const sh of arr ) out.push( { id: sh.id, k: sh.k, n: sh.n, x: r1( sh.x ), z: r1( sh.z ), y: r2( sh.y ), s: r2( sh.s ), hp: r1( sh.hp ), mx: r1( sh.mx ), st: sh.st, r: r2( sh.r ) } );
	return out;

}

function clockOf( c ) {

	const out = { timeOfDay: c.timeOfDay, timeSpeed: c.timeSpeed, at: c.at };
	if ( c.day >= 0 ) {

		out.day = c.day;
		out.seed = c.seed;

	}

	return out;

}

// the readable refusal of a failed join: an Error with .code (a name) and .text
export function joinError( e, kind = 'room' ) {

	const n = errorCode( e );
	let code = REFUSAL_OF[ n ] || null;
	const missing = n === ErrorCode.MATCHMAKE_INVALID_ROOM_ID || n === REFUSAL_HTTP.nocrew;
	if ( ! code && missing ) code = kind === 'universe' ? 'nouniverse' : kind === 'crew' ? 'nocrew' : 'rooms';
	if ( ! code && n === REFUSAL_HTTP.rooms ) code = 'rooms';
	if ( ! code && e && e.code === 'timeout' ) code = 'timeout';
	if ( ! code ) code = n ? 'refused' : 'down';
	const text = e && e.message ? String( e.message ) : '';
	const err = new Error( text || code );
	err.code = code;
	err.text = ( REFUSAL_OF[ n ] || missing || n === REFUSAL_HTTP.rooms ) ? text : '';
	err.status = n;
	return err;

}

const noop = () => {};

export class ColyseusLink {

	constructor( { url, onMessage = noop, onDrop = noop, onReconnect = noop, onClose = noop } = {} ) {

		this.url = url;
		this.target = linkTarget( url );
		this.onMessage = onMessage;
		this.onDrop = onDrop;
		this.onReconnect = onReconnect;
		this.onClose = onClose;
		this.client = null;
		this.room = null; // the @colyseus/sdk Room
		this.roomName = this.target ? this.target.room : null;
		this.id = null;
		this.closed = false;
		this.dropped = false;
		this._welcome = null; // the server's welcome, waiting for the first full state
		this._welcomed = false;
		this._known = new Map(); // id -> { seq, profile }
		this._host = '';
		this._clockAt = 0;
		this._shipsAt = 0;
		this._offs = [];

	}

	get open() {

		return !! ( this.room && ! this.dropped && this.room.connection && this.room.connection.isOpen );

	}

	async join( hello ) {

		const t = this.target;
		if ( ! t ) throw Object.assign( new Error( 'bad server address' ), { code: 'down', text: '' } );
		this.client = new Client( t.endpoint );
		let room = null;
		try {

			if ( t.kind === 'room' ) room = await this._timed( this.client.joinOrCreate( 'room', { ...hello, room: t.room } ) );
			else room = await this._timed( this.client.joinById( t.room, { ...hello } ) );

		} catch ( e ) {

			throw joinError( e, t.kind );

		}

		if ( this.closed ) {

			try { room.leave( true ); } catch ( e ) { /* gone */ }
			throw Object.assign( new Error( 'closed' ), { code: 'closed', text: '' } );

		}

		this._attach( room );
		return this;

	}

	_timed( p ) {

		return new Promise( ( resolve, reject ) => {

			let fired = false;
			const timer = setTimeout( () => {

				fired = true;
				reject( Object.assign( new Error( 'no answer' ), { code: 'timeout' } ) );

			}, JOIN_TIMEOUT );
			p.then( ( v ) => {

				clearTimeout( timer );
				// a room that arrives after the timeout is left again
				if ( fired ) try { v.leave( true ); } catch ( e ) { /* gone */ }
				else resolve( v );

			}, ( e ) => {

				clearTimeout( timer );
				if ( ! fired ) reject( e );

			} );

		} );

	}

	_attach( room ) {

		this.room = room;
		this._welcome = null;
		this._welcomed = false;
		this._known.clear();
		// the SDK retries a dropped socket for about as long as the server keeps the seat
		room.reconnection.minUptime = 1000;
		room.reconnection.maxDelay = 5000;
		room.reconnection.maxRetries = Math.max( 3, Math.ceil( RECONNECT_SECONDS / 4 ) );
		room.onStateChange( () => this._onState() );
		room.onMessage( '*', ( type, body ) => this._onServerMessage( type, body ) );
		room.onDrop( ( code ) => {

			if ( this.room !== room ) return;
			this.dropped = true;
			this._welcomed = false; // the welcome after the reconnect rebuilds the peers
			this.onDrop( { code } );

		} );
		room.onReconnect( () => {

			if ( this.room !== room ) return;
			this.dropped = false;
			this.onReconnect();

		} );
		room.onLeave( ( code ) => {

			if ( this.room !== room ) return;
			this._unbind();
			this.room = null;
			this.onClose( { code, kick: KICK_CLOSE[ code ] || null } );

		} );
		room.onError( () => {} );
		// joins and leaves through the schema callbacks (they also fire for what is already there: the welcome covers that)
		const cb = Callbacks.get( room );
		this._offs.push( cb.onAdd( 'players', ( pl, id ) => {

			if ( ! this._welcomed || this._known.has( id ) ) return;
			this._known.set( id, { seq: - 1, profile: pl.profile } ); // (seq -1: its state goes out with this patch)
			if ( id !== this.id ) this._emit( { t: 'join', peer: peerOf( pl ) } );

		} ) );
		this._offs.push( cb.onRemove( 'players', ( pl, id ) => {

			if ( ! this._welcomed || ! this._known.has( id ) ) return;
			this._known.delete( id );
			if ( id !== this.id ) this._emit( { t: 'leave', id } );

		} ) );
		this._offs.push( cb.listen( 'host', ( v ) => {

			const id = v || '';
			if ( ! this._welcomed || id === this._host ) return;
			const prev = this._host;
			this._host = id;
			this._emit( { t: 'host', id: id || null, prev: prev || undefined } );

		} ) );

	}

	_unbind() {

		for ( const off of this._offs.splice( 0 ) ) try { if ( typeof off === 'function' ) off(); } catch ( e ) { /* gone */ }

	}

	_emit( m ) {

		try {

			this.onMessage( m );

		} catch ( e ) {

			console.warn( 'ColyseusLink: a listener threw', e );

		}

	}

	_onServerMessage( type, body ) {

		if ( typeof type !== 'string' ) return;
		if ( type === 'welcome' ) {

			this._welcome = body && typeof body === 'object' ? body : {};
			if ( this.room && this.room.state && this.room.state.players ) this._emitWelcome();
			return;

		}

		this._emit( body && typeof body === 'object' && ! Array.isArray( body ) ? { ...body, t: type } : { t: type, body } );

	}

	_onState() {

		const st = this.room && this.room.state;
		if ( ! st || ! st.players ) return;
		if ( ! this._welcomed ) {

			if ( this._welcome ) this._emitWelcome();
			return;

		}

		this._diff( st );

	}

	_emitWelcome() {

		const st = this.room.state, w = this._welcome;
		this._welcome = null;
		this._welcomed = true;
		this.id = w.id;
		const peers = [];
		this._known.clear();
		st.players.forEach( ( pl, id ) => {

			this._known.set( id, { seq: pl.seq, profile: pl.profile } );
			if ( id === w.id ) return;
			const p = peerOf( pl );
			if ( pl.has ) p.state = playerState( pl );
			peers.push( p );

		} );
		this._host = st.host || '';
		this._clockAt = st.clock ? st.clock.at : 0;
		this._shipsAt = st.shipsAt;
		this._emit( { ...w, t: 'welcome', peers, host: st.host || w.host || null } );
		// late joiners see the host's ships at once (the host itself runs them)
		if ( st.ships && st.ships.length && st.host !== this.id && st.shipsHost !== this.id ) this._emit( { t: 'world', at: st.shipsAt, host: st.shipsHost || null, ships: shipsOf( st.ships ) } );

	}

	// once per patch: the states that moved, profile changes, the clock and the host's ships
	_diff( st ) {

		const states = [];
		st.players.forEach( ( pl, id ) => {

			const k = this._known.get( id );
			if ( ! k ) return;
			if ( k.profile !== pl.profile ) {

				k.profile = pl.profile;
				if ( id !== this.id ) this._emit( { t: 'join', peer: peerOf( pl ) } );

			}

			if ( k.seq !== pl.seq ) {

				k.seq = pl.seq;
				if ( id !== this.id && pl.has ) states.push( { id, ...playerState( pl ) } );

			}

		} );
		if ( states.length ) this._emit( { t: 'states', at: st.at || Date.now(), list: states } );
		if ( st.clock && st.clock.at !== this._clockAt ) {

			this._clockAt = st.clock.at;
			this._emit( { t: 'clock', ...clockOf( st.clock ) } );

		}

		if ( st.shipsAt !== this._shipsAt ) {

			this._shipsAt = st.shipsAt;
			if ( st.shipsHost !== this.id && st.ships && st.ships.length ) this._emit( { t: 'world', at: st.shipsAt, host: st.shipsHost || null, ships: shipsOf( st.ships ) } );

		}

	}

	send( msg ) {

		if ( ! msg || typeof msg.t !== 'string' ) return false;
		const { t, ...body } = msg;
		return this.sendRaw( t, body );

	}

	sendRaw( type, payload ) {

		const room = this.room;
		if ( ! room || ! this.open ) return false;
		try {

			room.send( type, payload );
			return true;

		} catch ( e ) {

			console.warn( 'ColyseusLink: send failed', e );
			return false;

		}

	}

	// a goodbye: the server lets the seat go at once
	leave() {

		this.closed = true;
		const room = this.room;
		this.room = null;
		this._unbind();
		if ( room ) try { room.leave( true ); } catch ( e ) { /* gone */ }

	}

	// the socket closes as if the network went away (the server keeps the seat; the SDK reconnects unless reconnect is false)
	drop( reconnect = true ) {

		const room = this.room;
		if ( ! room ) return;
		if ( ! reconnect ) room.reconnection.enabled = false;
		if ( room.connection ) try { room.connection.close(); } catch ( e ) { /* gone */ }

	}

}
