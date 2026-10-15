// The Colyseus rooms of a Hyptile Island server (server/index.mjs builds them per server: `makeRooms( ctx )`).
//
//   'room'      plain rooms by name (joinOrCreate, filterBy room: 'island', 'cove-2' ...) and crew rooms (6-letter codes,
//               reserved by a 'createCrew' message, joined by id). Cap ctx.opts.roomCap. An empty room dies after
//               opts.emptyMs (a fresh crew code is held opts.crewHoldMs); 'island' stays.
//   'universe'  the one persistent universe (roomId 'universe', created at start, never disposed: its clock runs with
//               nobody online). Captains are admitted by server/universe.mjs (name + token hash); cap opts.universeCap.
//
// Both keep the semantics of the 2.x relay (src/net/Protocol.js): the oldest connected player is the world host (pirates,
// market) and the host role migrates when it leaves or drops; the server seats ride guests; 'fx' goes to the others, 'hit' to
// the host; 'event' to the others (the universe persists the kinds it knows). Players, host, clock, moored boats and the
// host's ships are schema state (server/schema.mjs); the rest are messages. The hello is the join options; refusals are
// ServerErrors with a REFUSAL code. A dropped client keeps its seat RECONNECT_SECONDS (colyseus allowReconnection), so a
// short network hiccup is not a leave; a replaced / kicked / banned one is closed with a KICK_CLOSE code.
//
// Wave 11 (multiplayer parity): 'bump' from the host goes to the owner of the struck boat only (the host resolves the remote
// boats' hull collisions, src/features/netsync/HullLink.js); 'wreck' adds / removes the sender's own entries of the schema's
// `wrecks` map (dropped with the owner in onLeave, kept over a reconnect); cannon 'fx' shots and firearm 'gunshot' events
// faster than the weapon reloads are dropped (Protocol.FireGate); only the host fires balls that are not a player's ('o').
//
// Wave 13 (planes, the stronghold, the town): 'plane' sets / removes the sender's own entries of the schema's `planes` map
// (a 'stray' abandoned plane streamed until it wrecks, a 'parked' airframe; dropped with the owner); 'fort' is the Blackwater
// stronghold: the host's snapshot ('set') goes into the schema's `fort`, a guest's hostile act ('act') goes to the host alone,
// and a 'claim' from anybody is granted once ('fortClaim' answers the claimant; the host's `open` must say it is undefended);
// 'ask' carries a guest's request to the host alone (a raid only the host may spawn). Prop events (propDestroyed,
// propRespawned, propsRespawned) have their own budget, so a powder blast breaking a dozen props loses none; the universe stores
// a host's batched respawns like single ones.
//
// Wave 22A (cars): 'cars' from the host only (CARS_RATE, the frame cap, sanitizeCars) goes to everybody else with the server's
// `at`: Meridian's traffic as lane codes and the loose cars as poses (src/features/cars/CarNet.js); never stored.

import { Room, ServerError, CloseCode, matchMaker } from '@colyseus/core';
import {
	PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, SEND_HZ, MAX_FRAME, MAX_SAVE, MAX_MARKET, CLOCK_START, CLOCK_SPEED, RIDE_RANGE, WORLD_HZ,
	UNIVERSE_PATH, DEFAULT_ROOM, REFUSAL, REFUSAL_HTTP,
	sanitizeHello, sanitizeState, sanitizeChat, sanitizeRoom, sanitizeEvent, sanitizeWorld, sanitizeFx, sanitizeHit,
	isCrewRoom, makeCrewCode,
	sanitizeBump, sanitizeWreck, FireGate, CANNON_GATE, GUN_GATE, BUMP_REACH, MAX_WRECKS_PER_PLAYER, MAX_ROOM_WRECKS,
	sanitizePlane, sanitizeFort, sanitizeAsk, MAX_PLANES_PER_PLAYER, MAX_ROOM_PLANES, PLANE_RATE, FORT_CLAIM_EVERY,
} from '../src/net/Protocol.js';
import { BOATS } from '../src/game/Boats.js';
import { WEAPONS } from '../src/features/firearms/FirearmsData.js';
import { HyptileState, Player, writePlayerState, writeShips, writeMoored, writeWreck, writePlane, writeFort, readFort, restoreFort } from './schema.mjs';

const SHIP_GATE = { ...CANNON_GATE, reload: CANNON_GATE.shipReload };
const PROP_EVENTS = new Set( [ 'propDestroyed', 'propRespawned', 'propsRespawned' ] );
// CityWreck._sendStages and TownLink._flush publish host simulation state, not guest actions.
// Single prop respawns use the same authority as the batched form. Navy hails already have host-only delivery below.
const HOST_WORLD_EVENTS = new Set( [ 'cityStages', 'propRespawned', 'propsRespawned', 'navyHail' ] );
// These notices originate in this room's moor/unmoor lifecycle and must never be client-authored.
const SERVER_WORLD_EVENTS = new Set( [ 'boatMoored', 'boatUnmoored' ] );
// Exhaustive current hostRequest consumers: CityWreck._onHostRequest and Story's raid listener.
// Keep action validation in those consumers; the server only restricts which requests can reach them.
const HOST_REQUESTS = new Set( [ 'cityHit', 'citySnap', 'raid' ] );
// wave 22A: the host's cars snapshot (src/features/cars/CarNet.js): 2 Hz, 4 Hz in a chase; a little room over that
export const CARS_RATE = { n: 8, ms: 1000 };
const CARS_MAX = { traffic: 64, free: 16 };
const CAR_KEY = /^[A-Za-z0-9:_-]{1,12}$/;
const int = ( v, lo, hi ) => Number.isInteger( v ) && v >= lo && v <= hi;

// { tm, tr: [ [ id, kc, L, N, s, v ] ], fr: [ [ id, kc, x, z, yaw, v, flags ] ], d?, gone?: [ id ] } with every number in
// range, or null
export function sanitizeCars( m ) {

	if ( ! m || typeof m !== 'object' ) return null;
	const tr = Array.isArray( m.tr ) ? m.tr : [], fr = Array.isArray( m.fr ) ? m.fr : [];
	if ( tr.length > CARS_MAX.traffic || fr.length > CARS_MAX.free ) return null;
	const out = { tm: Number.isFinite( m.tm ) ? Math.round( m.tm * 100 ) / 100 : 0, tr: [], fr: [] };
	if ( m.d ) {

		// a delta: the traffic cars that changed, and the ids that left
		const gone = Array.isArray( m.gone ) ? m.gone : [];
		if ( gone.length > CARS_MAX.traffic || ! gone.every( ( n ) => int( n, 0, 1e7 ) ) ) return null;
		out.d = 1;
		out.gone = gone.slice();

	}

	for ( const e of tr ) {

		if ( ! Array.isArray( e ) || e.length !== 6 ) return null;
		if ( ! int( e[ 0 ], 0, 1e7 ) || ! int( e[ 1 ], 0, 511 ) || ! int( e[ 2 ], 0, 1e6 ) || ! int( e[ 3 ], - 1, 1e6 ) || ! int( e[ 4 ], - 100, 1e5 ) || ! int( e[ 5 ], - 100, 1000 ) ) return null;
		out.tr.push( e.slice() );

	}

	for ( const e of fr ) {

		if ( ! Array.isArray( e ) || e.length !== 7 || typeof e[ 0 ] !== 'string' || ! CAR_KEY.test( e[ 0 ] ) ) return null;
		if ( ! int( e[ 1 ], 0, 511 ) || ! int( e[ 2 ], - 1e6, 1e6 ) || ! int( e[ 3 ], - 1e6, 1e6 ) || ! int( e[ 4 ], - 1000, 1000 ) || ! int( e[ 5 ], - 1000, 1000 ) || ! int( e[ 6 ], 0, 15 ) ) return null;
		out.fr.push( e.slice() );

	}

	return out;

}

const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const makeId = ( taken ) => {

	for ( ;; ) {

		let id = '';
		for ( let i = 0; i < 6; i ++ ) id += ID_CHARS[ Math.floor( Math.random() * ID_CHARS.length ) ];
		if ( ! taken.has( id ) ) return id;

	}

};

const refuse = ( code, text ) => new ServerError( REFUSAL[ code ] || 4000, text );
// (onCreate runs inside the HTTP matchmaking request: its code must be an HTTP status)
const refuseHttp = ( code, text ) => new ServerError( REFUSAL_HTTP[ code ] || 409, text );
const size = ( m ) => {

	try {

		return m === undefined ? 0 : JSON.stringify( m ).length;

	} catch ( e ) {

		return Infinity;

	}

};

export function makeRooms( ctx ) {

	const { opts } = ctx;
	const log = ( ...a ) => opts.log( ...a );

	const MESSAGES = [ 'hello', 'state', 'chat', 'ping', 'createCrew', 'ridePolicy', 'ride', 'unride', 'world', 'fx', 'hit', 'event', 'save', 'market', 'bump', 'wreck', 'plane', 'fort', 'ask', 'cars' ];

	class HyptileRoom extends Room {

		// 0.18 room configuration as class properties
		state = new HyptileState();
		autoDispose = false; // empty rooms are retired by tick() below (a crew code waits for its creator)
		patchRate = 1000 / opts.tickHz;
		maxClients = ( this.isUniverse ? opts.universeCap : opts.roomCap ) + 8; // (probes and replaced captains briefly hold a seat; the cap is checked in onAuth)
		maxMessagesPerSecond = 400; // colyseus' own flood cut; ours (120 / s, dropped) comes first
		// every handler goes through _message (the frame size, the 120 / s budget, then on_<type>); unknown types are ignored
		messages = {
			...Object.fromEntries( MESSAGES.map( ( type ) => [ type, ( client, m ) => this._message( type, client, m ) ] ) ),
			'*': () => {},
		};

		get isUniverse() {

			return false;

		}

		onCreate( options = {} ) {

			const name = this.isUniverse ? UNIVERSE_PATH : sanitizeRoom( options.room );
			if ( ! this.isUniverse ) {

				// a crew code exists only once createCrew reserved it; a new plain room needs a free slot
				if ( isCrewRoom( name ) && ! ctx.creating.has( name ) ) throw refuseHttp( 'nocrew', `no crew ${ name }` );
				if ( name === UNIVERSE_PATH ) throw refuseHttp( 'nouniverse', 'This server hosts no universe (start it with --universe <name>)' );
				if ( ctx.rooms.size >= opts.maxRooms ) throw refuseHttp( 'rooms', 'the server has no free room' );
				if ( ctx.rooms.has( name ) ) throw refuseHttp( 'rooms', `room ${ name } is being created` );

			}

			this.roomId = name;
			this.label = name;
			this.uni = this.isUniverse ? ctx.universe : null;
			this.cap = this.isUniverse ? opts.universeCap : opts.roomCap;
			this.members = new Map(); // sessionId -> member
			this.order = new Map(); // id -> member, in host order (the oldest connected first)
			this.createdAt = Date.now();
			this.emptySince = Date.now();
			this.creator = ctx.creating.has( name ) ? options.creator || '?' : null; // the address that reserved a crew code
			this.joined = false;
			this.clockAt = this.uni ? this.uni.state.epoch : Date.now(); // a universe's day runs from its creation, online or not
			this.lastClock = 0;
			this.lastWorld = null; // { at, host, ships } the host's newest list (adopted by the next host of the universe)
			this._dirty = false;
			const st = this.state;
			st.room = name;
			st.crew = isCrewRoom( name );
			st.universe = this.uni ? this.uni.name : '';
			if ( this.uni ) {

				if ( this.uni.state.ships.length ) {

					this.lastWorld = { at: this.uni.state.shipsAt || Date.now(), host: null, ships: this.uni.state.ships };
					writeShips( st.ships, this.uni.state.ships );
					st.shipsAt = this.lastWorld.at;

				}

				for ( const m of Object.values( this.uni.state.moored ) ) writeMoored( st.moored, m );
				// Blackwater as it was left (wave 15: the fort outlives a restart, like the moored boats)
				if ( this.uni.state.fort && restoreFort( st.fort, this.uni.state.fort ) ) log( `fort  ${ name } restored: ${ st.fort.holder }${ st.fort.byName ? ' (' + st.fort.byName + ')' : '' }` );

			}

			this._writeClock( Date.now() );
			this.setTimestep( () => this.tick(), Math.round( 1000 / opts.tickHz ) ); // (cleared with the room)
			ctx.rooms.set( name, this );
			log( `room  ${ name } created` );

		}

		onDispose() {

			if ( ctx.rooms.get( this.label ) === this ) ctx.rooms.delete( this.label );

		}

		// ---- who is here

		connected() {

			const out = [];
			for ( const m of this.order.values() ) if ( ! m.dropped ) out.push( m );
			return out;

		}

		hostId() {

			for ( const m of this.order.values() ) if ( ! m.dropped ) return m.id;
			for ( const m of this.order.values() ) return m.id;
			return null;

		}

		guestsOf( id ) {

			const out = [];
			for ( const m of this.order.values() ) if ( m.rideHost === id ) out.push( m );
			return out;

		}

		rides() {

			const out = [];
			for ( const m of this.order.values() ) if ( m.rideHost ) out.push( { guest: m.id, host: m.rideHost, seat: m.rideSeat } );
			return out;

		}

		peerInfo( m ) {

			const p = { id: m.id, name: m.name, character: m.character, boat: m.boat, open: m.rideOpen !== false };
			if ( m.captainKey ) p.captain = m.captainKey;
			return p;

		}

		tell( m, type, body ) {

			if ( m && m.client && ! m.dropped ) m.client.send( type, body );

		}

		broadcastExcept( type, body, except = null ) {

			for ( const m of this.order.values() ) if ( m !== except ) this.tell( m, type, body );

		}

		dayClock( now = Date.now() ) {

			const hours = CLOCK_START + ( now - this.clockAt ) / 1000 * CLOCK_SPEED;
			const c = { timeOfDay: Math.round( ( ( hours % 24 + 24 ) % 24 ) * 1e4 ) / 1e4, timeSpeed: CLOCK_SPEED, at: now };
			if ( this.uni ) {

				c.day = Math.floor( hours / 24 );
				c.seed = this.uni.state.weatherSeed;

			}

			return c;

		}

		_writeClock( now ) {

			const c = this.dayClock( now ), sc = this.state.clock;
			sc.timeOfDay = c.timeOfDay;
			sc.timeSpeed = c.timeSpeed;
			sc.at = c.at;
			if ( this.uni ) {

				sc.day = c.day;
				sc.seed = c.seed;

			}

			this.lastClock = now;

		}

		// the host may have changed (a join into an empty room, a leave, a drop): tell everybody through the state
		_updateHost( prevId ) {

			const id = this.hostId() || '';
			if ( this.state.host === id ) return;
			this.state.host = id;
			const h = this.order.get( id );
			if ( prevId && this.uni && h && this.lastWorld ) {

				// the universe keeps its ships: the next captain runs them from where they were
				this.tell( h, 'world', { ...this.lastWorld, host: id, adopt: true } );

			} else if ( prevId && ! this.uni ) {

				// a crew's ships went with their host: the new one spawns its own sea
				this.lastWorld = null;
				this.state.ships.clear();
				this.state.shipsHost = '';

			}

		}

		unride( m, reason ) {

			if ( ! m.rideHost ) return false;
			const host = m.rideHost;
			m.rideHost = null;
			m.rideSeat = 0;
			if ( m.lastState ) {

				m.lastState.mode = m.lastState.mode === 'ride' ? 'walk' : m.lastState.mode;
				m.lastState.ride = null;
				m.lastState.seat = 0;
				this._writeState( m );

			}

			this.broadcastExcept( 'unride', { guest: m.id, host, reason } );
			return true;

		}

		_writeState( m ) {

			writePlayerState( m.player, m.lastState );
			this._dirty = true;

		}

		onBeforePatch() {

			if ( this._dirty ) {

				this._dirty = false;
				this.state.at = Date.now();

			}

		}

		// ---- joining

		onAuth( client, options = {}, context = {} ) {

			if ( ctx.closing ) throw refuse( 'full', 'the server is shutting down' );
			const remote = String( context.ip || '?' );
			if ( typeof options.v !== 'number' || options.v < MIN_PROTOCOL_VERSION || options.v > PROTOCOL_VERSION ) throw refuse( 'version', `protocol ${ PROTOCOL_VERSION } required` );
			if ( this.uni && options.v < 2 ) throw refuse( 'version', 'This universe needs a newer game (protocol 2)' );
			const h = sanitizeHello( options );
			if ( ! h ) throw refuse( 'hello', 'bad hello' );
			const auth = { hello: h, remote, probe: false, captain: null, captainKey: null, isNew: false, old: null };
			if ( this.uni ) {

				// a captain: the name must belong to this browser's token (the first token to use a name owns it)
				const a = this.uni.admit( { name: options.name, token: options.token, remote } );
				if ( ! a.ok ) throw refuse( a.code, a.text );
				for ( const m of this.order.values() ) if ( m.captainKey === a.key ) auth.old = m;
				if ( ! auth.old && this.order.size >= this.cap ) throw refuse( 'full', `The universe is full (${ this.cap } captains online)` );
				auth.captain = h.name = a.name;
				auth.captainKey = a.key;
				auth.isNew = a.isNew;
				auth.probe = options.probe === true;

			} else if ( this.order.size >= this.cap ) throw refuse( 'full', `room ${ this.label } is full` );

			return auth;

		}

		onJoin( client, options, auth ) {

			const uni = this.uni;
			if ( auth.probe ) {

				// the menu asks before it starts the game: the stored game (or none); nobody joins (the client leaves at once)
				this.members.set( client.sessionId, { client, probe: true } );
				const profile = uni.loadProfile( auth.captainKey );
				client.send( 'profile', { captain: auth.captain, exists: !! profile, isNew: auth.isNew, profile, universe: uni.info(), players: this.connected().length, cap: this.cap } );
				this.clock.setTimeout( () => { try { client.leave( CloseCode.CONSENTED ); } catch ( e ) { /* gone */ } }, 5000 );
				return;

			}

			if ( auth.old ) {

				// the same captain from another window (or a dropped one still holding its seat): the newest one wins
				this.kick( auth.old, 'replaced', 'You joined this universe from another window' );

			}

			const h = auth.hello;
			const m = {
				client, id: makeId( this.order ), name: h.name, character: h.character, boat: h.boat, lastState: null, remote: auth.remote,
				rideHost: null, rideSeat: 0, rideOpen: true, limits: new Map(), lastWorldAt: 0, lastCrewAt: 0, chatTimes: [],
				captain: auth.captain, captainKey: auth.captainKey, startedAt: Date.now(), dropped: false, kicked: false, reconnection: null,
				player: new Player(), gate: new FireGate(),
			};
			const pl = m.player;
			pl.id = m.id;
			pl.name = m.name;
			pl.character = m.character;
			pl.owned = m.boat || '';
			pl.captain = m.captainKey || '';
			this.members.set( client.sessionId, m );
			this.order.set( m.id, m );
			this.state.players.set( m.id, pl );
			this.emptySince = 0;
			this.joined = true;
			this._updateHost( null );
			const welcome = { id: m.id, you: this.peerInfo( m ), clock: this.dayClock(), room: this.label, host: this.state.host, rides: this.rides(), crew: isCrewRoom( this.label ) };
			if ( uni ) {

				const online = new Set();
				for ( const o of this.order.values() ) if ( o !== m ) online.add( o.captainKey );
				welcome.universe = uni.info();
				welcome.captain = m.captain;
				welcome.world = uni.worldFor( m.captainKey, online );
				uni.seen( m.captainKey );

			}

			client.send( 'welcome', welcome );
			// a new host of the universe takes the stored ships over (the others see them in the state)
			if ( uni && this.lastWorld && this.state.host === m.id ) client.send( 'world', { ...this.lastWorld, host: m.id, adopt: true } );
			if ( uni && uni.unmoor( m.captainKey ) ) {

				this.state.moored.delete( m.captainKey );
				this.broadcastExcept( 'event', { kind: 'boatUnmoored', data: { captain: m.captainKey }, from: 'server', at: Date.now() }, m );

			}

			log( `join  ${ this.label } ${ m.id } "${ m.name }" (${ m.character }${ m.boat ? ', ' + m.boat : '' }) from ${ m.remote }; ${ this.order.size } in room` );

		}

		// an unexpected close: the seat is kept RECONNECT_SECONDS (same id, same boat, host role passed on meanwhile); the
		// outcome goes to onReconnect or onLeave (allowReconnection is not awaited)
		onDrop( client, code ) {

			const m = this.members.get( client.sessionId );
			// (1001: the page went away, a leave; a kicked / replaced one and a server shutting down keep nothing either)
			if ( ! m || m.probe || m.kicked || ctx.closing || ! opts.reconnectSeconds || code === CloseCode.GOING_AWAY ) return;
			m.dropped = true;
			const prevHost = this.state.host;
			this.unride( m, 'left' );
			for ( const g of this.guestsOf( m.id ) ) this.unride( g, 'gone' );
			// to the back of the host order: a returning player does not take the ships back
			this.order.delete( m.id );
			this.order.set( m.id, m );
			this._updateHost( prevHost );
			log( `drop  ${ this.label } ${ m.id } "${ m.name }" (close ${ code }); seat kept ${ opts.reconnectSeconds } s` );
			m.reconnection = this.allowReconnection( client, opts.reconnectSeconds );
			m.reconnection.catch( () => {} ); // (a timeout or a replacement: onLeave follows)

		}

		onReconnect( client ) {

			const m = this.members.get( client.sessionId );
			if ( ! m ) return;
			m.client = client;
			m.dropped = false;
			m.reconnection = null;
			const prevHost = this.state.host;
			this._updateHost( prevHost );
			// the same welcome again: the client rebuilds its peers from the state that follows
			const welcome = { id: m.id, you: this.peerInfo( m ), clock: this.dayClock(), room: this.label, host: this.state.host, rides: this.rides(), crew: isCrewRoom( this.label ), reconnected: true };
			if ( this.uni ) {

				const online = new Set();
				for ( const o of this.order.values() ) if ( o !== m ) online.add( o.captainKey );
				welcome.universe = this.uni.info();
				welcome.captain = m.captain;
				welcome.world = this.uni.worldFor( m.captainKey, online );

			}

			client.send( 'welcome', welcome );
			log( `back  ${ this.label } ${ m.id } "${ m.name }"` );

		}

		// gone for good: a goodbye (CloseCode.CONSENTED), a kick, a shutdown, or a drop whose seat ran out
		onLeave( client, code ) {

			const m = this.members.get( client.sessionId );
			if ( ! m ) return;
			this.members.delete( client.sessionId );
			if ( m.probe ) return;
			if ( this.order.get( m.id ) !== m ) return;
			const prevHost = this.state.host;
			this.unride( m, 'left' );
			for ( const g of this.guestsOf( m.id ) ) this.unride( g, 'gone' );
			this.order.delete( m.id );
			this.state.players.delete( m.id );
			this.dropWrecks( m.id );
			this.dropPlanes( m.id );
			const uni = this.uni;
			if ( uni && m.captainKey ) {

				// the captain's boat stays where it was left, for the others to see (unless they are back in another window)
				uni.seen( m.captainKey );
				let back = false;
				for ( const o of this.order.values() ) if ( o.captainKey === m.captainKey ) back = true;
				const b = m.lastState && m.lastState.boat;
				const moored = b && ! back ? uni.moor( m.captainKey, m.captain, b ) : null;
				if ( moored ) {

					writeMoored( this.state.moored, moored );
					this.broadcastExcept( 'event', { kind: 'boatMoored', data: moored, from: 'server', at: Date.now() } );

				}

			}

			this._updateHost( prevHost );
			if ( ! this.order.size ) this.emptySince = Date.now();
			log( `leave ${ this.label } ${ m.id } "${ m.name }"; ${ this.order.size } in room` );

		}

		// the server ends a connection (admin kick / ban, a captain replaced by a newer window): no reconnection
		kick( m, code, text ) {

			m.kicked = true;
			if ( m.dropped && m.reconnection ) {

				m.reconnection.reject( false );
				return;

			}

			try {

				m.client.send( 'error', { code, text } );
				m.client.leave( REFUSAL[ code ] || CloseCode.WITH_ERROR, code );

			} catch ( e ) { /* gone */ }

		}

		// every wreck entry of a player (gone for good: nobody is left to salvage or recover them)
		dropWrecks( id ) {

			const map = this.state.wrecks, gone = [];
			map.forEach( ( e, key ) => { if ( e.owner === id ) gone.push( key ); } );
			for ( const key of gone ) map.delete( key );
			return gone.length;

		}

		// every plane entry of a player (gone for good: her stray and her parked airframe go with her)
		dropPlanes( id ) {

			const map = this.state.planes, gone = [];
			map.forEach( ( e, key ) => { if ( e.owner === id ) gone.push( key ); } );
			for ( const key of gone ) map.delete( key );
			return gone.length;

		}

		// ---- the SEND_HZ tick: ride sanity, the clock, the universe's expiries, retiring an empty room

		tick() {

			const now = Date.now();
			// a host whose boat is gone (sold, sunk, towed) puts its guests ashore
			for ( const m of [ ...this.order.values() ] ) {

				if ( ! m.rideHost ) continue;
				const h = this.order.get( m.rideHost );
				if ( ! h || ! h.lastState || ! h.lastState.boat ) this.unride( m, h ? 'noboat' : 'gone' );

			}

			if ( now - this.lastClock >= opts.clockEveryMs ) this._writeClock( now );
			if ( this.uni && now - ( this.lastExpire || 0 ) >= 1000 ) {

				this.lastExpire = now;
				for ( const e of this.uni.expire( now ) ) this.broadcastExcept( 'event', { kind: e.kind, data: e.data, from: 'server', at: now } );

			}

			if ( ! this.uni && this.label !== DEFAULT_ROOM && ! this.order.size && ! this.members.size ) {

				if ( ! this.emptySince ) this.emptySince = now;
				// an empty room is kept a little (a crew code is held longer so its creator can walk in)
				const hold = this.creator && ! this.joined ? opts.crewHoldMs : opts.emptyMs;
				if ( now - this.emptySince > hold && ! this._retiring ) {

					this._retiring = true;
					ctx.rooms.delete( this.label );
					this.disconnect().catch( () => {} );

				}

			}

		}

		// ---- messages

		// at most `n` messages of one kind per `ms` window
		allow( m, key, n, ms ) {

			const now = Date.now();
			let a = m.limits.get( key );
			if ( ! a ) m.limits.set( key, a = [] );
			while ( a.length && now - a[ 0 ] >= ms ) a.shift();
			if ( a.length >= n ) return false;
			a.push( now );
			return true;

		}

		_message( type, client, raw ) {

			const c = this.members.get( client.sessionId );
			if ( ! c || c.probe || c.dropped ) return;
			// only a captain's save and the host's market snapshot may be bigger than a plain frame
			if ( type === 'save' ) {

				if ( typeof raw === 'string' ? raw.length > MAX_SAVE : size( raw ) > MAX_SAVE ) {

					if ( c.captainKey ) this.tell( c, 'saved', { ok: false, reason: 'size', text: `That save is too large (${ Math.round( MAX_SAVE / 1024 ) } KB at most)` } );
					return;

				}

			} else if ( size( raw ) > ( type === 'market' ? MAX_MARKET + 1024 : MAX_FRAME ) ) return;
			if ( ! this.allow( c, 'all', 120, 1000 ) ) return; // a flood of anything is dropped
			const m = raw && typeof raw === 'object' && ! Array.isArray( raw ) ? raw : {};
			try {

				this[ 'on_' + type ]( c, m, raw );

			} catch ( e ) {

				log( `error ${ this.label } ${ c.id } ${ type }: ${ e.message }` );

			}

		}

		on_state( c, m ) {

			const s = sanitizeState( m );
			if ( ! s ) return;
			if ( s.character ) c.character = s.character;
			else s.character = c.character;
			if ( s.name !== undefined ) {

				if ( ! c.captainKey && c.name !== s.name ) {

					c.name = s.name; // a captain keeps the name the universe knows
					c.player.name = s.name;

				}

				delete s.name;

			}

			if ( s.boat ) c.boat = s.boat.id; // aboard: that is the boat they own
			// 'ride' is the server's word: only a guest the server seated is one, and it names the host and the seat
			if ( c.rideHost ) {

				s.mode = 'ride';
				s.ride = c.rideHost;
				s.seat = c.rideSeat;

			} else {

				if ( s.mode === 'ride' ) s.mode = 'walk';
				s.ride = null;
				s.seat = 0;

			}

			c.lastState = s;
			this._writeState( c );

		}

		on_chat( c, m ) {

			const text = sanitizeChat( m );
			if ( ! text ) return;
			const now = Date.now();
			c.chatTimes = c.chatTimes.filter( ( t ) => now - t < 1000 );
			if ( c.chatTimes.length >= 2 ) return; // 2 per second per client
			c.chatTimes.push( now );
			this.broadcastExcept( 'chat', { id: c.id, name: c.name, text, at: now } );
			if ( this.uni ) this.uni.pushChat( { name: c.name, text, at: now } );

		}

		on_ping( c, m ) {

			this.tell( c, 'pong', { c: typeof m.c === 'number' ? m.c : 0, at: Date.now() } );

		}

		// a second hello updates the profile (name outside a universe, character, owned boat)
		on_hello( c, m ) {

			const h = sanitizeHello( m );
			if ( ! h ) return;
			if ( ! c.captainKey ) c.name = h.name;
			c.character = h.character;
			c.boat = h.boat;
			const pl = c.player;
			pl.name = c.name;
			pl.character = c.character;
			pl.owned = c.boat || '';
			if ( c.lastState ) {

				c.lastState.character = c.character;
				this._writeState( c );

			}

			pl.profile = ( pl.profile + 1 ) & 0xffff;

		}

		async on_createCrew( c ) {

			if ( Date.now() - c.lastCrewAt < opts.crewEveryMs ) return this.tell( c, 'error', { code: 'rate', text: 'wait a moment before another crew code' } );
			c.lastCrewAt = Date.now();
			let mine = 0;
			for ( const r of ctx.rooms.values() ) if ( r.creator === c.remote && ! r.order.size ) mine ++;
			if ( ctx.rooms.size + ctx.creating.size >= opts.maxRooms || mine >= opts.crewPerAddress ) return this.tell( c, 'error', { code: 'rooms', text: 'no crew room is free right now' } );
			const code = makeCrewCode( ( k ) => ctx.rooms.has( k ) || ctx.creating.has( k ) );
			if ( ! code ) return this.tell( c, 'error', { code: 'rooms', text: 'no crew room is free right now' } );
			ctx.creating.add( code );
			try {

				await matchMaker.createRoom( 'room', { room: code, creator: c.remote } );
				log( `crew  ${ code } reserved by ${ c.id } "${ c.name }"` );
				this.tell( c, 'crew', { code } );

			} catch ( e ) {

				this.tell( c, 'error', { code: 'rooms', text: 'no crew room is free right now' } );

			} finally {

				ctx.creating.delete( code );

			}

		}

		on_ridePolicy( c, m ) {

			const open = m.open !== false;
			if ( open === c.rideOpen ) return;
			c.rideOpen = open;
			c.player.open = open;
			if ( ! open ) for ( const g of this.guestsOf( c.id ) ) this.unride( g, 'closed' );
			this.broadcastExcept( 'policy', { id: c.id, open } );

		}

		on_ride( c, m ) {

			if ( ! this.allow( c, 'ride', 3, 2000 ) ) return;
			const no = ( reason ) => this.tell( c, 'rideNo', { host: typeof m.host === 'string' ? m.host.slice( 0, 12 ) : '', reason } );
			const h = typeof m.host === 'string' ? this.order.get( m.host ) : null;
			if ( ! h || h === c || h.dropped ) return no( 'gone' );
			if ( c.rideHost ) return no( 'busy' );
			if ( h.rideHost ) return no( 'hostRiding' );
			if ( ! h.rideOpen ) return no( 'closed' );
			const hb = h.lastState && h.lastState.boat, me = c.lastState;
			if ( ! hb || ! me ) return no( 'noboat' );
			if ( Math.hypot( me.p[ 0 ] - hb.p[ 0 ], me.p[ 2 ] - hb.p[ 2 ] ) > RIDE_RANGE || Math.abs( me.p[ 1 ] - hb.p[ 1 ] ) > 8 ) return no( 'range' );
			const seats = Math.max( 1, ( BOATS[ hb.id ] && BOATS[ hb.id ].seats ? BOATS[ hb.id ].seats.length : 0 ) );
			const taken = new Set( this.guestsOf( h.id ).map( ( g ) => g.rideSeat ) );
			let seat = - 1;
			for ( let i = 0; i < seats; i ++ ) if ( ! taken.has( i ) ) { seat = i; break; }
			if ( seat < 0 ) return no( 'full' );
			c.rideHost = h.id;
			c.rideSeat = seat;
			if ( c.lastState ) {

				c.lastState.mode = 'ride';
				c.lastState.ride = h.id;
				c.lastState.seat = seat;
				this._writeState( c );

			}

			this.broadcastExcept( 'ride', { guest: c.id, host: h.id, seat } );

		}

		on_unride( c ) {

			this.unride( c, 'left' ); // (the state goes back to walk with it)

		}

		on_world( c, m ) {

			// only the room's host simulates the ships; everybody else's snapshot is ignored
			if ( this.state.host !== c.id ) return;
			const now = Date.now();
			if ( now - c.lastWorldAt < 1000 / ( WORLD_HZ * 2.5 ) ) return; // 12 Hz at most
			c.lastWorldAt = now;
			const w = sanitizeWorld( m );
			if ( ! w ) return;
			this.lastWorld = { at: now, host: c.id, ships: w.ships };
			writeShips( this.state.ships, w.ships );
			this.state.shipsAt = now;
			this.state.shipsHost = c.id;
			if ( this.uni ) this.uni.setShips( w.ships ); // the pirates outlive a restart

		}

		on_fx( c, m ) {

			if ( ! this.allow( c, 'fx', 30, 1000 ) ) return;
			const fx = sanitizeFx( m );
			if ( ! fx ) return;
			const host = this.state.host === c.id;
			if ( fx.kind === 'shot' ) {

				// a player's ball never hurts a boat (d 0); only the host's ships fire the others; each side no faster than it reloads
				if ( fx.o === 'player' ) fx.d = 0;
				else if ( ! host ) return;
				if ( ( c.lastGatePrune || 0 ) + 30000 < Date.now() ) { c.lastGatePrune = Date.now(); c.gate.prune( Date.now() ); }
				if ( ! c.gate.volley( `shot|${ fx.o }|${ fx.sd || '?' }`, Date.now(), fx.o === 'player' ? CANNON_GATE : SHIP_GATE ) ) return;

			} else if ( fx.kind === 'ram' && ! host ) return; // (the host resolves the remote hulls)
			this.broadcastExcept( 'fx', { id: c.id, ...fx }, c );

		}

		on_hit( c, m ) {

			if ( ! this.allow( c, 'hit', 20, 1000 ) ) return;
			const hid = this.state.host;
			if ( hid === c.id ) return; // the host applies its own hits locally
			const hit = sanitizeHit( m );
			const h = hid ? this.order.get( hid ) : null;
			if ( ! hit || ! h ) return;
			this.tell( h, 'hit', { from: c.id, ...hit } );

		}

		on_event( c, m ) {

			// a world event (a destroyed prop, a trade, a claimed bounty): to everybody else; the universe keeps the known kinds.
			const e = sanitizeEvent( m );
			if ( ! e || SERVER_WORLD_EVENTS.has( e.kind ) || HOST_WORLD_EVENTS.has( e.kind ) && this.state.host !== c.id ) return;
			// Props have their own budget (a powder store's blast breaks a dozen at once)
			const prop = PROP_EVENTS.has( e.kind );
			if ( ! ( prop ? this.allow( c, 'event:prop', 40, 1000 ) : this.allow( c, 'event', 10, 1000 ) ) ) return;
			if ( e.kind === 'propsRespawned' && ! ( Array.isArray( e.data?.ids ) && e.data.ids.every( ( id ) => typeof id === 'string' ) ) ) return;
			if ( e.kind === 'gunshot' ) {

				// a flintlock holds one ball: a weapon's shots come no faster than it reloads
				const d = e.data, w = WEAPONS[ d.weapon ];
				if ( ! w || ! [ d.x, d.y, d.z ].every( Number.isFinite ) ) return;
				if ( ! c.gate.single( 'gun|' + d.weapon, Date.now(), w.reload * GUN_GATE ) ) return;

			}

			const at = Date.now();
			if ( e.kind === 'navyHail' ) {

				// wave 20E: the host's navy hails one player: to him alone (never stored; the host resends until he says he heard)
				const to = typeof e.data.to === 'string' ? this.order.get( e.data.to ) : null;
				if ( this.state.host === c.id && to && to !== c ) this.tell( to, 'event', { kind: e.kind, data: e.data, from: c.id, at } );
				return;

			}

			this.broadcastExcept( 'event', { kind: e.kind, data: e.data, from: c.id, at }, c );
			if ( ! this.uni ) return;
			if ( e.kind === 'propsRespawned' ) {

				// the host's batched respawns clear the stored breaks one by one
				for ( const id of e.data.ids ) this.uni.recordEvent( c.captainKey, c.id, 'propRespawned', { id, port: e.data.port }, at );

			} else this.uni.recordEvent( c.captainKey, c.id, e.kind, e.data, at );

		}

		// the host resolved a hull collision of another player's boat: the impulse and the damage go to that boat's owner only
		on_bump( c, m ) {

			if ( this.state.host !== c.id || ! this.allow( c, 'bump', 30, 1000 ) ) return;
			const b = sanitizeBump( m );
			const t = b ? this.order.get( b.to ) : null;
			if ( ! t || t === c || t.dropped ) return;
			const tb = t.lastState && t.lastState.boat;
			if ( ! tb ) return;
			// the blow lands on that boat (where its owner last said it was)
			const half = BOATS[ tb.id ] ? BOATS[ tb.id ].length / 2 : 5;
			if ( Math.hypot( b.p[ 0 ] - tb.p[ 0 ], b.p[ 1 ] - tb.p[ 2 ] ) > half + BUMP_REACH ) return;
			if ( ! this.allow( c, 'bump:' + t.id, 10, 1000 ) ) return;
			const { to, ...body } = b;
			this.tell( t, 'bump', { from: c.id, ...body } );

		}

		// a player's own wreck entries (keyed '<owner>:<id>': nobody else can touch them)
		on_wreck( c, m ) {

			if ( ! this.allow( c, 'wreck', 8, 1000 ) ) return;
			const w = sanitizeWreck( m );
			if ( ! w ) return;
			const map = this.state.wrecks, key = c.id + ':' + w.id;
			if ( w.op === 'del' ) {

				if ( map.has( key ) ) map.delete( key );
				return;

			}

			if ( ! map.has( key ) ) {

				let mine = 0;
				map.forEach( ( e ) => { if ( e.owner === c.id ) mine ++; } );
				if ( mine >= MAX_WRECKS_PER_PLAYER || map.size >= MAX_ROOM_WRECKS ) return;

			}

			writeWreck( map, c.id, w );

		}

		// ---- wave 13

		// a player's own plane entries (keyed '<owner>:<id>': nobody else can touch them)
		on_plane( c, m ) {

			if ( ! this.allow( c, 'plane', PLANE_RATE.n, PLANE_RATE.ms ) ) return;
			const e = sanitizePlane( m );
			if ( ! e ) return;
			const map = this.state.planes, key = c.id + ':' + e.id;
			if ( e.op === 'del' ) {

				if ( map.has( key ) ) map.delete( key );
				return;

			}

			if ( ! map.has( key ) ) {

				let mine = 0;
				map.forEach( ( pe ) => { if ( pe.owner === c.id ) mine ++; } );
				if ( mine >= MAX_PLANES_PER_PLAYER || map.size >= MAX_ROOM_PLANES ) return;

			}

			writePlane( map, c.id, e );

		}

		// the stronghold: the host's snapshot, a guest's hostile act (to the host), a claim (granted once)
		on_fort( c, m ) {

			const f = sanitizeFort( m );
			if ( ! f ) return;
			const fort = this.state.fort, hid = this.state.host;
			if ( f.op === 'set' ) {

				if ( hid !== c.id || ! this.allow( c, 'fort', 10, 1000 ) ) return;
				writeFort( fort, f );
				if ( this.uni ) this.uni.setFort( readFort( fort ) );
				return;

			}

			if ( f.op === 'act' ) {

				if ( hid === c.id || ! this.allow( c, 'fort:act', f.act === 'hostile' ? 2 : 4, 1000 ) ) return;
				const h = hid ? this.order.get( hid ) : null;
				if ( h ) this.tell( h, 'fortAct', { from: c.id, act: f.act, why: f.why } );
				return;

			}

			// a claim: one player gets it; a host that runs the stronghold must have said it is undefended
			if ( ! this.allow( c, 'fort:claim', 1, FORT_CLAIM_EVERY ) ) return this.tell( c, 'fortClaim', { ok: false, reason: 'rate' } );
			if ( fort.holder !== 'pirates' ) return this.tell( c, 'fortClaim', { ok: false, reason: 'taken', by: fort.by } );
			if ( fort.seq > 0 && ! fort.open ) return this.tell( c, 'fortClaim', { ok: false, reason: 'defended' } );
			fort.holder = 'player';
			fort.by = c.id;
			fort.byName = c.name;
			fort.claims = ( fort.claims + 1 ) & 0xffff;
			fort.claimedAt = - 1; // (the host's clock fills it in)
			fort.until = - 1;
			fort.open = false;
			log( `fort  ${ this.label } claimed by ${ c.id } "${ c.name }"` );
			if ( this.uni ) this.uni.setFort( readFort( fort ) );
			this.tell( c, 'fortClaim', { ok: true, by: c.id, claims: fort.claims } );

		}

		// wave 22A: the host's traffic, police and loose cars for the guests in Meridian (netsync/CarLink.js): to everybody
		// else, with the server's time; never stored (the next host runs its own)
		on_cars( c, m ) {

			if ( this.state.host !== c.id || ! this.allow( c, 'cars', CARS_RATE.n, CARS_RATE.ms ) ) return;
			const s = sanitizeCars( m );
			if ( ! s ) return;
			this.broadcastExcept( 'cars', { from: c.id, at: Date.now(), ...s }, c );

		}

		// a guest asks the host to run something only the host may (src/features/netsync: sync.askHost)
		on_ask( c, m ) {

			const hid = this.state.host;
			if ( hid === c.id ) return; // (the host runs it itself)
			const a = sanitizeAsk( m );
			const h = hid ? this.order.get( hid ) : null;
			if ( ! a || ! HOST_REQUESTS.has( a.kind ) || ! h || h.dropped || ! this.allow( c, 'ask', 4, 1000 ) ) return;
			this.tell( h, 'ask', { from: c.id, kind: a.kind, data: a.data } );

		}

		on_save( c, m, raw ) {

			if ( ! this.uni || ! c.captainKey ) return;
			if ( ! this.allow( c, 'save', 1, opts.saveEveryMs ) ) return this.tell( c, 'saved', { ok: false, reason: 'rate' } );
			// the client sends the GameState JSON as text (one parse, here); an object is accepted too
			let profile = raw;
			if ( typeof raw === 'string' ) {

				try {

					profile = JSON.parse( raw );

				} catch ( e ) {

					return this.tell( c, 'saved', { ok: false, reason: 'shape' } );

				}

			} else if ( raw && raw.profile && typeof raw.profile === 'object' ) profile = raw.profile;
			const r = this.uni.storeProfile( c.captainKey, profile, { startedAt: c.startedAt } );
			this.tell( c, 'saved', { ok: r.ok, at: Date.now(), fix: r.fix || undefined, reason: r.reason } );

		}

		on_market( c, m ) {

			// the host's trade market: kept for everybody who joins later, and the captains online adopt it
			if ( ! this.uni || this.state.host !== c.id || ! this.allow( c, 'market', 1, opts.marketEveryMs ) ) return;
			if ( this.uni.setMarket( m.sim ) ) this.broadcastExcept( 'market', { sim: this.uni.state.market.sim, at: this.uni.state.market.at }, c );

		}

	}

	class UniverseRoom extends HyptileRoom {

		get isUniverse() {

			return true;

		}

	}

	return { HyptileRoom, UniverseRoom };

}
