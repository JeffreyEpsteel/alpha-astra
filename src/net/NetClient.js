// Browser client of the Hyptile Island server (server/index.mjs, Colyseus 0.18): one room connection (src/net/ColyseusLink.js
// over @colyseus/sdk), the hello as join options, throttled state sends, chat, pings with an rtt / clock-offset estimate.
// A dropped socket is reconnected by the SDK to the same seat and id (RECONNECT_SECONDS); when the room is gone (server
// restart, FAILED_TO_RECONNECT) a fresh join follows with backoff (1 s .. 15 s).
//
//   const net = new NetClient( { url, name, character, boat,
//                                onPeerJoin( peer ), onPeerLeave( id ), onStates( list, at ), onChat( msg ),
//                                onClock( clock ), onStatus( status, detail ) } );
//   net.connect();  net.send( state );  net.chat( text );  net.setProfile( { name, character, boat } );  net.disconnect();
//   net.online, net.id, net.peers (Map id -> { name, character, boat }), net.rtt (ms), net.clock (last clock msg),
//   net.serverOffset (Date.now() - server now, ms; smoothed from pongs)
//
// `state` is the raw object of Protocol.sanitizeState: { p, yaw, mode, speed, vy, grounded, diving, action,
// character, boat }. send() quantizes and skips frames that did not change beyond the wire rounding, and never
// sends faster than SEND_HZ (a heartbeat goes out once a second even when idle so late joiners get placed).
// Callbacks never throw out of the client: errors are console.warn'd.
//
// Crews, passengers and the shared ships (server/rooms.mjs, src/features/netsync):
//   net.createCrew() -> Promise<code>  asks for a fresh 6-letter crew code and joins its room (createCrew( { join: false } ) only asks)
//   net.joinCrew( code ) -> bool       moves to ws://<same host>/<code>; net.crewCode is the code of the current room (or null)
//   net.host (id), net.isHost          the room's world host (the oldest player; migrates when they leave)
//   net.rides (Map guest id -> { host, seat }), net.closed (Set of peer ids that take no guests)
//   net.ride( hostId ) / net.unride() / net.setRidePolicy( open )
//   net.sendWorld( ships ) (host only) / net.sendFx( fx ) / net.sendHit( { ship, dmg, part } )
//   net.on( type, fn ) -> off          listen to any server message after the client handled it (welcome, world, fx, hit, ride,
//                                      unride, rideNo, host, crew, policy, event, saved, market, error...); net.sendMsg( msg ) for a raw one
//
// The persistent universe (a URL whose path is /universe, server started with --universe; see src/net/Universe.js):
//   net.universe (bool)                the hello carries this browser's captain token for that server (universeToken)
//   net.universeInfo / net.captain     from the welcome: { name, day, seed, bountySeed, createdAt } and the captain name
//   net.world                          the welcome's { events, boats, market, chat } (NetSync replays it)
//   net.sendEvent( kind, data )        a world event to everybody else in the room (any room, protocol 2)
//   net.sendSave( json ) / net.sendMarket( sim )   a captain's GameState JSON (text) / the host's market snapshot
//   net.lastError                      { code, text } of the last refusal (text is readable: Universe.universeError)
// Refusals a retry cannot fix (full, version, name taken, banned, replaced, kicked...) stop the reconnect loop.

import {
	PROTOCOL_VERSION, SEND_HZ, DEFAULT_ROOM,
	sanitizeState, stateChanged, helloMessage, cleanName, cleanCharacter, cleanBoat,
	sanitizeCrewCode, isCrewRoom, crewUrl, isUniverseUrl, MAX_SAVE, MAX_MARKET,
} from './Protocol.js';
import { universeToken, universeError, isDefaultUniverse } from './Universe.js';
import { ColyseusLink } from './ColyseusLink.js';

// refusals after which reconnecting cannot help
const FATAL = new Set( [ 'full', 'version', 'rooms', 'nocrew', 'name', 'banned', 'replaced', 'nouniverse', 'badname', 'token', 'kicked', 'rate' ] );

export const DEFAULT_PORT = 8875;

// `?server=` query parameter when present, else ws(s)://<page host>:8765/island
export function defaultServerUrl() {

	let loc = null;
	try {

		loc = typeof location !== 'undefined' ? location : null;
		if ( loc && loc.search ) {

			const q = new URLSearchParams( loc.search ).get( 'server' );
			if ( q ) return normalizeServerUrl( q, loc );

		}

		const crew = crewCodeFromLocation( loc );
		if ( crew && loc.protocol !== 'https:' ) {

			const secure = loc.protocol === 'https:';
			return `${ secure ? 'wss' : 'ws' }://${ loc.hostname || 'localhost' }:${ DEFAULT_PORT }/${ crew }`;

		}

	} catch ( e ) { /* no location (tests) */ }

	const host = loc && loc.hostname ? loc.hostname : 'localhost';
	const secure = loc && loc.protocol === 'https:';
	if ( secure ) return ''; // Static Pages needs an explicitly configured Alpha Astra server.
	return `${ secure ? 'wss' : 'ws' }://${ host }:${ DEFAULT_PORT }/${ DEFAULT_ROOM }`;

}

// a crew code in the page address: ?crew=abcdef, or a page path of exactly 6 letters (/abcdef); null otherwise
export function crewCodeFromLocation( loc = typeof location !== 'undefined' ? location : null ) {

	try {

		if ( ! loc ) return null;
		const q = loc.search ? new URLSearchParams( loc.search ).get( 'crew' ) : null;
		const c = sanitizeCrewCode( q );
		if ( c ) return c;
		const path = String( loc.pathname || '' ).replace( /^\/+|\/+$/g, '' );
		return isCrewRoom( path.toLowerCase() ) ? path.toLowerCase() : null;

	} catch ( e ) {

		return null;

	}

}

// accepts "host", "host:port", "host:port/room", "ws://...", "wss://..." (?server=wss://hyptile-universe.fly.dev/universe keeps 443)
export function normalizeServerUrl( s, loc = null ) {

	s = String( s || '' ).trim().replace( /^https:\/\//i, 'wss://' ).replace( /^http:\/\//i, 'ws://' ); // a tunnel's https address
	if ( ! s ) return defaultServerUrl();
	if ( ! /^wss?:\/\//i.test( s ) ) {

		const secure = loc && loc.protocol === 'https:';
		s = `${ secure ? 'wss' : 'ws' }://${ s }`;

	}

	try {

		const u = new URL( s );
		// plain ws gets the server's port; wss without one is a TLS front on 443 (the shared universe on Fly.io, a tunnel, Caddy)
		if ( ! u.port && u.protocol === 'ws:' ) u.port = String( DEFAULT_PORT );
		if ( ! u.pathname || u.pathname === '/' ) u.pathname = '/' + DEFAULT_ROOM;
		return u.toString();

	} catch ( e ) {

		return s;

	}

}

const noop = () => {};
const safe = ( fn, label ) => ( ...args ) => {

	try {

		return fn( ...args );

	} catch ( e ) {

		console.warn( `NetClient: ${ label } threw`, e );

	}

};

export class NetClient {

	constructor( { url, name, character, boat = null, token = null, onPeerJoin, onPeerLeave, onStates, onChat, onClock, onStatus } = {} ) {

		this.url = url || defaultServerUrl();
		this.name = cleanName( name );
		this.character = cleanCharacter( character );
		this.boat = cleanBoat( boat );
		this.onPeerJoin = safe( onPeerJoin || noop, 'onPeerJoin' );
		this.onPeerLeave = safe( onPeerLeave || noop, 'onPeerLeave' );
		this.onStates = safe( onStates || noop, 'onStates' );
		this.onChat = safe( onChat || noop, 'onChat' );
		this.onClock = safe( onClock || noop, 'onClock' );
		this.onStatus = safe( onStatus || noop, 'onStatus' );

		this.link = null; // the ColyseusLink of the current connection
		this.online = false;
		this.status = 'offline';
		this.id = null;
		this.room = null;
		this.peers = new Map();
		this.rtt = 0;
		this.serverOffset = 0;
		this.clock = null;
		this.sent = 0; // frames sent
		this.received = 0;
		this.host = null; // id of the room's world host
		this.crewCode = null;
		this.rides = new Map(); // guest id -> { host, seat }
		this.closed = new Set(); // peers that take no guests
		this._on = new Map(); // message type -> Set of listeners
		this.token = token; // the universe captain token (null: universeToken( url ) when the URL is a universe)
		this.universeInfo = null;
		this.captain = null;
		this.world = null;
		this.lastError = null;
		this._wasOnline = false; // reached the server at least once (else a drop reads "server down")
		this._crewWaiters = [];

		this._wanted = false; // connect() called and not disconnect()ed
		this._backoff = 1000;
		this._reconnectTimer = 0;
		this._pingTimer = 0;
		this._lastSent = null;
		this._lastSentAt = 0;
		this._profileDirty = false;
		this._pingAt = 0;
		this._pongSeen = true;

	}

	// true when the current URL is a universe (ws://host:port/universe)
	get universe() {

		return isUniverseUrl( this.url );

	}

	connect() {

		this._wanted = true;
		clearTimeout( this._reconnectTimer );
		this._reconnectTimer = 0;
		if ( this.link ) return;
		const link = new ColyseusLink( {
			url: this.url,
			onMessage: ( m ) => {

				if ( link !== this.link ) return;
				this.received ++;
				this._handle( m );

			},
			// the SDK is retrying the same seat: offline meanwhile (the server's welcome after the reconnect restores the peers)
			onDrop: () => { if ( link === this.link ) this._dropped(); },
			onClose: ( info ) => { if ( link === this.link ) this._onClose( link, info ); },
		} );
		this.link = link;
		this._setStatus( 'connecting', this.url );
		link.join( this._hello() ).then( () => {

			if ( link !== this.link ) return link.leave();
			this._lastSent = null;
			this._lastSentAt = 0;
			this._profileDirty = false;

		}, ( e ) => {

			if ( link !== this.link ) return;
			this.link = null;
			if ( FATAL.has( e.code ) ) {

				// full room, protocol mismatch, no free room, unknown crew code, a name / ban refusal: retrying will not help
				this._wanted = false;
				this.lastError = { code: e.code, text: universeError( e.code, e.text, this.url ) };
				this._setStatus( 'error', this.lastError.text );
				return;

			}

			// never reached: say so in words (the backoff keeps trying)
			this._setStatus( 'offline', this._wasOnline ? ( e.text || e.message || 'connection lost' ) : universeError( e.code === 'timeout' ? 'timeout' : 'down', '', this.url ) );
			this._scheduleReconnect();

		} );

	}

	// the socket dropped; the SDK reconnects to the same seat (or gives up: onClose)
	_dropped() {

		this._offline();
		this._setStatus( 'connecting', 'connection lost: reconnecting' );

	}

	// the room connection ended
	_onClose( link, { code, kick } ) {

		this._teardown();
		if ( kick ) {

			// banned, replaced by another window, kicked by the admin: retrying will not help
			this._wanted = false;
			const e = this.lastError && this.lastError.code === kick ? this.lastError : { code: kick, text: universeError( kick, '', this.url ) };
			this.lastError = e;
			this._setStatus( 'error', e.text );
			return;

		}

		// a server restart or a seat that could not be got back: a fresh join after a pause
		// (the shared universe restarts on every deploy: Fly sends SIGTERM, the server saves and says 4001)
		this._setStatus( 'offline', code === 4001 ? ( this.universe && isDefaultUniverse( this.url ) ? 'the universe is updating: back in a minute' : 'the server restarted' ) : `connection lost (${ code })` );
		this._scheduleReconnect();

	}

	disconnect() {

		this._wanted = false;
		clearTimeout( this._reconnectTimer );
		this._reconnectTimer = 0;
		this._backoff = 1000;
		const link = this.link;
		this._teardown();
		if ( link ) link.leave();
		this._setStatus( 'offline', 'disconnected' );

	}

	// call every frame with the raw state; throttled to SEND_HZ and skipped when unchanged
	send( state ) {

		if ( ! this.online ) return false;
		const now = performance.now();
		if ( now - this._lastSentAt < 1000 / SEND_HZ ) return false;
		const s = sanitizeState( state );
		if ( ! s ) {

			console.warn( 'NetClient: refusing to send a malformed state', state );
			return false;

		}

		if ( ! s.character ) s.character = this.character;
		if ( this._profileDirty ) {

			s.name = this.name;
			s.character = this.character;
			this._profileDirty = false;

		}

		const heartbeat = now - this._lastSentAt > 1000;
		if ( ! heartbeat && s.name === undefined && ! stateChanged( this._lastSent, s ) ) return false;
		this._lastSent = s;
		this._lastSentAt = now;
		this._raw( { t: 'state', ...s } );
		this.sent ++;
		return true;

	}

	chat( text ) {

		text = String( text == null ? '' : text ).trim();
		if ( ! text || ! this.online ) return false;
		this._raw( { t: 'chat', text: text.slice( 0, 200 ) } );
		return true;

	}

	// ---- crews, passengers and the shared ships

	on( type, fn ) {

		let set = this._on.get( type );
		if ( ! set ) this._on.set( type, set = new Set() );
		set.add( fn );
		return () => set.delete( fn );

	}

	sendMsg( msg ) {

		if ( ! this.online ) return false;
		this._raw( msg );
		return true;

	}

	get isHost() {

		return this.online && this.host !== null && this.host === this.id;

	}

	// asks the server for a crew code; resolves with it (and, unless join is false, moves this client into that room)
	createCrew( { join = true } = {} ) {

		return new Promise( ( resolve, reject ) => {

			if ( ! this.online ) return reject( new Error( 'not connected' ) );
			const w = { resolve: null, timer: 0 };
			w.timer = setTimeout( () => {

				const i = this._crewWaiters.indexOf( w );
				if ( i >= 0 ) this._crewWaiters.splice( i, 1 );
				reject( new Error( 'the server did not answer' ) );

			}, 5000 );
			w.resolve = ( m ) => {

				clearTimeout( w.timer );
				if ( m.error || ! m.code ) return reject( new Error( m.error || 'bad crew code' ) );
				if ( join ) this.joinCrew( m.code );
				resolve( m.code );

			};
			this._crewWaiters.push( w );
			this._raw( { t: 'createCrew' } );

		} );

	}

	// leave this room for the crew's: same server, path /<code>. false for a malformed code.
	joinCrew( code ) {

		const c = sanitizeCrewCode( code );
		const url = c ? crewUrl( this.url, c ) : null;
		if ( ! url ) return false;
		this.url = url;
		this._wanted = true;
		this._backoff = 1000;
		const link = this.link;
		this._teardown();
		if ( link ) link.leave();
		clearTimeout( this._reconnectTimer );
		this._reconnectTimer = 0;
		this.connect();
		return true;

	}

	ride( hostId ) {

		return this.sendMsg( { t: 'ride', host: String( hostId ) } );

	}

	unride() {

		return this.sendMsg( { t: 'unride' } );

	}

	setRidePolicy( open ) {

		return this.sendMsg( { t: 'ridePolicy', open: open !== false } );

	}

	sendWorld( ships ) {

		return this.isHost && this.sendMsg( { t: 'world', ships } );

	}

	sendFx( fx ) {

		return this.sendMsg( { t: 'fx', ...fx } );

	}

	sendHit( hit ) {

		return this.sendMsg( { t: 'hit', ...hit } );

	}

	// a world event for everybody else in the room (the universe persists the kinds it knows); never echoed back
	sendEvent( kind, data = {} ) {

		if ( typeof kind !== 'string' || ! kind ) return false;
		return this.sendMsg( { t: 'event', kind, data } );

	}

	// the captain's game (GameState JSON text) to a universe; it goes as text so the server parses it once
	sendSave( json ) {

		if ( ! this.online || ! this.universe || typeof json !== 'string' || json.length > MAX_SAVE || ! this.link ) return false;
		return this.link.sendRaw( 'save', json );

	}

	// the world host's trade market snapshot (kept by the universe for later joiners)
	sendMarket( sim ) {

		if ( ! this.universe || ! this.isHost || ! sim ) return false;
		if ( JSON.stringify( sim ).length > MAX_MARKET ) return false;
		return this.sendMsg( { t: 'market', sim } );

	}

	// the hello: a universe adds the captain token (one per server, Universe.js)
	_hello() {

		const h = helloMessage( this );
		if ( this.universe ) h.token = this.token || ( this.token = universeToken( this.url ) );
		return h;

	}

	_emit( type, m ) {

		const set = this._on.get( type );
		if ( ! set ) return;
		for ( const fn of [ ...set ] ) {

			try {

				fn( m );

			} catch ( e ) {

				console.warn( `NetClient: listener of ${ type } threw`, e );

			}

		}

	}

	// new name / character / boat: goes out with the next state (and with the next hello after a reconnect)
	setProfile( { name, character, boat } = {} ) {

		if ( name !== undefined ) this.name = cleanName( name );
		if ( character !== undefined ) this.character = cleanCharacter( character );
		if ( boat !== undefined ) this.boat = cleanBoat( boat );
		this._profileDirty = true;
		this._lastSentAt = 0; // let the next send go out at once
		if ( this.online ) this._raw( this._hello() ); // a second hello updates the profile (incl. the owned boat) server side

	}

	dispose() {

		this.disconnect();

	}

	// ---- internals

	_handle( m ) {

		switch ( m.t ) {

			case 'welcome':
				// (also after the SDK reconnected the seat: the server says welcome again)
				this._pongSeen = true;
				clearInterval( this._pingTimer );
				this._pingTimer = setInterval( () => this._ping(), 5000 );
				this._ping();
				this.id = m.id;
				this.room = m.room || DEFAULT_ROOM;
				this.peers.clear();
				this._backoff = 1000;
				this.online = true;
				this._wasOnline = true;
				this.lastError = null;
				this.universeInfo = m.universe && typeof m.universe === 'object' ? m.universe : null;
				this.captain = typeof m.captain === 'string' ? m.captain : null;
				this.world = m.world && typeof m.world === 'object' ? m.world : null;
				if ( this.captain ) this.name = cleanName( this.captain ); // the universe's spelling of the name
				this.host = typeof m.host === 'string' ? m.host : null;
				this.crewCode = isCrewRoom( this.room ) ? this.room : null;
				this.rides.clear();
				this.closed.clear();
				if ( Array.isArray( m.rides ) ) for ( const r of m.rides ) if ( r && typeof r.guest === 'string' ) this.rides.set( r.guest, { host: r.host, seat: r.seat | 0 } );
				this._setStatus( 'online', this.universeInfo ? `universe ${ this.universeInfo.name } as ${ this.captain || this.name }` : `${ this.room } as ${ m.you ? m.you.name : this.name }` );
				if ( Array.isArray( m.peers ) ) {

					const states = [];
					for ( const p of m.peers ) {

						if ( ! p || typeof p.id !== 'string' ) continue;
						if ( p.open === false ) this.closed.add( p.id );
						this.peers.set( p.id, { name: p.name, character: p.character, boat: p.boat } );
						this.onPeerJoin( { id: p.id, name: p.name, character: p.character, boat: p.boat } );
						if ( p.state ) states.push( { id: p.id, ...p.state } );

					}

					if ( states.length ) this.onStates( states, m.clock ? m.clock.at : Date.now() );

				}

				if ( m.clock ) {

					this.clock = m.clock;
					this.onClock( m.clock );

				}

				break;

			case 'join':
				// a join for a known id is a profile update (name / character / owned boat)
				if ( m.peer && typeof m.peer.id === 'string' && m.peer.id !== this.id ) {

					this.peers.set( m.peer.id, { name: m.peer.name, character: m.peer.character, boat: m.peer.boat } );
					if ( m.peer.open === false ) this.closed.add( m.peer.id );
					else this.closed.delete( m.peer.id );
					this.onPeerJoin( m.peer );

				}

				break;

			case 'leave':
				if ( typeof m.id === 'string' && this.peers.has( m.id ) ) {

					this.peers.delete( m.id );
					this.closed.delete( m.id );
					this.rides.delete( m.id );
					this.onPeerLeave( m.id );

				}

				break;

			case 'host':
				this.host = typeof m.id === 'string' ? m.id : null;
				break;

			case 'policy':
				if ( typeof m.id === 'string' ) {

					if ( m.open === false ) this.closed.add( m.id );
					else this.closed.delete( m.id );

				}

				break;

			case 'ride':
				if ( typeof m.guest === 'string' && typeof m.host === 'string' ) this.rides.set( m.guest, { host: m.host, seat: m.seat | 0 } );
				break;

			case 'unride':
				if ( typeof m.guest === 'string' ) this.rides.delete( m.guest );
				break;

			case 'crew': {

				const w = this._crewWaiters.shift();
				if ( w ) w.resolve( { code: sanitizeCrewCode( m.code ) } );
				break;

			}

			case 'states':
				if ( Array.isArray( m.list ) ) {

					const list = [];
					for ( const s of m.list ) {

						if ( ! s || typeof s.id !== 'string' || s.id === this.id ) continue;
						let peer = this.peers.get( s.id );
						if ( ! peer ) {

							// state before the join (reordered during a reconnect): adopt the peer
							peer = { name: s.name || '?', character: s.character, boat: s.boat ? s.boat.id : null };
							this.peers.set( s.id, peer );
							this.onPeerJoin( { id: s.id, ...peer } );

						}

						if ( s.name ) peer.name = s.name;
						if ( s.character ) peer.character = s.character;
						if ( s.boat ) peer.boat = s.boat.id; // aboard: that is their boat; ashore keeps the owned one
						list.push( s );

					}

					if ( list.length ) this.onStates( list, typeof m.at === 'number' ? m.at : Date.now() );

				}

				break;

			case 'chat':
				if ( typeof m.text === 'string' ) this.onChat( { id: m.id, name: m.name, text: m.text, at: m.at, own: m.id === this.id, system: m.system === true || undefined } );
				break;

			case 'pong': {

				const now = performance.now();
				if ( typeof m.c === 'number' && m.c === this._pingAt ) {

					const rtt = now - m.c;
					this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
					if ( typeof m.at === 'number' ) {

						const off = Date.now() - ( m.at + rtt / 2 );
						this.serverOffset = this.serverOffset ? this.serverOffset * 0.8 + off * 0.2 : off;

					}

				}

				this._pongSeen = true;
				break;

			}

			case 'clock':
				this.clock = { timeOfDay: m.timeOfDay, timeSpeed: m.timeSpeed, at: m.at };
				if ( typeof m.day === 'number' ) {

					// the universe's day number and weather seed
					this.clock.day = m.day;
					this.clock.seed = m.seed;
					if ( this.universeInfo ) this.universeInfo.day = m.day;

				}

				this.onClock( this.clock );
				break;

			case 'error':
				// a refused crew code request is not a dead connection
				if ( m.code === 'rate' || ( m.code === 'rooms' && this._crewWaiters.length ) ) {

					const w = this._crewWaiters.shift();
					if ( w ) w.resolve( { error: m.text || m.code } );
					break;

				}

				if ( m.code === 'size' ) break; // an oversized save is not a dead connection ('saved' tells the session)
				this.lastError = { code: m.code, text: universeError( m.code, m.text, this.url ) };
				console.warn( 'NetClient: server error', m.code, m.text );
				this._setStatus( 'error', this.lastError.text );
				break;

			default:
				break;

		}

		this._emit( m.t, m );

	}

	_ping() {

		if ( ! this.link || this.link.dropped ) return;
		if ( ! this._pongSeen && this._pingAt && performance.now() - this._pingAt > 15000 ) {

			// three pings without an answer: the socket is dead; closing it lets the reconnect take over
			this.link.drop();
			return;

		}

		this._pingAt = performance.now();
		this._pongSeen = false;
		this._raw( { t: 'ping', c: this._pingAt } );

	}

	_raw( msg ) {

		if ( this.link ) this.link.send( msg );

	}

	_teardown() {

		this._offline();
		this.link = null;

	}

	// not online any more (a drop keeps the link for the SDK's reconnect; _teardown lets it go)
	_offline() {

		clearInterval( this._pingTimer );
		this._pingTimer = 0;
		const wasOnline = this.online;
		this.online = false;
		this.id = null;
		this.host = null;
		this.crewCode = null;
		this.rides.clear();
		this.closed.clear();
		for ( const w of this._crewWaiters.splice( 0 ) ) w.resolve( { error: 'disconnected' } );
		if ( wasOnline ) for ( const id of [ ...this.peers.keys() ] ) {

			this.peers.delete( id );
			this.onPeerLeave( id );

		}

		this.peers.clear();

	}

	_scheduleReconnect() {

		if ( ! this._wanted || this._reconnectTimer ) return;
		const wait = this._backoff;
		this._backoff = Math.min( 15000, this._backoff * 2 );
		this._setStatus( 'connecting', `retry in ${ ( wait / 1000 ).toFixed( 0 ) } s` );
		this._reconnectTimer = setTimeout( () => {

			this._reconnectTimer = 0;
			if ( this._wanted ) this.connect();

		}, wait );

	}

	_setStatus( status, detail = '' ) {

		this.status = status;
		this.statusDetail = detail;
		this.onStatus( status, detail );

	}

}

export { PROTOCOL_VERSION };
