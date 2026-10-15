// The messages of Hyptile Island multiplayer, shared by server/ and src/net/NetClient.js.
//
// Transport (wave 4): Colyseus 0.18 (server/rooms.mjs, client @colyseus/sdk). Each `{ t, ...body }` below is a Colyseus
// message of type `t` with the body as its payload (msgpack); the hello is the join options. The players, the host, the
// clock, the moored boats and the host's ships live in the room's @colyseus/schema state (15 Hz patches);
// src/net/ColyseusLink.js turns those patches back into the 'welcome' peers, 'join' / 'leave' / 'states' / 'host' / 'clock' /
// 'world' messages listed here, so the rest of the game still sees this one vocabulary. Refusals at join are Colyseus
// errors whose code is a REFUSAL number; kicks after a join are close codes (KICK_CLOSE), all in the application range
// 4011..4999 (4000..4010 are Colyseus' own). A dropped client is reconnected by the SDK within RECONNECT_SECONDS, same id.
//
//   client -> server
//     { t: 'hello', v: PROTOCOL_VERSION, name, character, boat }
//     { t: 'state', p: [ x, y, z ], yaw, mode, speed, vy, grounded, diving, action, character, name?,
//                   boat: null | { id, p: [ x, y, z ], q: [ x, y, z, w ], throttle, steer, rpm, driven } }
//     { t: 'chat', text }                      (MAX_CHAT chars, control characters stripped)
//     { t: 'ping', c }                         (c: any number the client wants echoed)
//     { t: 'createCrew' }                      ask for a fresh 6-letter crew code (answered with 'crew')
//     { t: 'ride', host } / { t: 'unride' }    board / leave another player's boat as a guest
//     { t: 'ridePolicy', open }                a boat owner takes guests (default) or not
//     { t: 'world', ships: [ { id, k, n, x, z, y, s, hp, mx, st } ] }   the HOST only: AI ships at 5 Hz
//     { t: 'fx', kind: 'shot', from: [ x, y, z ], dir: [ x, y, z ], v, d, o, big }   cannon fire, shown to everybody
//     { t: 'hit', ship, dmg, part }            damage dealt to a ship; the server forwards it to the host only
//     (wave 11) shots also carry sd ('port' | 'starboard' | '') and c (a crew gunner's id); { t: 'fx', kind: 'ram', x, y, z, v }
//     a hull collision's splinters and crunch (the host sends it for the remote boats' blows)
//     { t: 'bump', to, j: [ jx, jz ], p: [ px, pz ], dmg, v, by, f: [ x, z ] }   the HOST only: a hull collision of player `to`'s
//                                              boat (src/features/netsync/HullLink.js); forwarded to that player alone
//     { t: 'wreck', op: 'add', id, kind, model, x, y, z, yaw, pitch, roll, parts } / { t: 'wreck', op: 'del', id }
//                                              the sender's own wrecks (kind 'sinking' | 'boat' | 'plane'): the room keeps them in
//                                              its schema state (wrecks, key '<owner>:<id>') until deleted or the owner leaves
//   server -> client
//     { t: 'welcome', id, you: { id, name, character, boat }, peers: [ { id, name, character, boat, state? } ],
//                     clock: { timeOfDay, timeSpeed, at }, room }
//     { t: 'join', peer: { id, name, character, boat } }
//     { t: 'leave', id }
//     { t: 'states', at, list: [ { id, ...state } ] }   (SEND_HZ fan-out of the states that changed)
//     { t: 'chat', id, name, text, at }
//     { t: 'pong', c, at }
//     { t: 'clock', timeOfDay, timeSpeed, at }
//     { t: 'error', code, text }               ('version' | 'full' | 'hello' | 'rooms' | 'nocrew' | 'rate')
//     { t: 'crew', code }                      answer to createCrew; the room exists, join it by the URL path /<code>
//     { t: 'host', id, prev? }                 the room's world host changed (the oldest player; migrates on leave)
//     { t: 'ride', guest, host, seat } / { t: 'unride', guest, host, reason } / { t: 'rideNo', host, reason }
//     { t: 'policy', id, open }                a peer's ridePolicy changed
//     { t: 'world', at, host, ships }          the host's ships, relayed to everybody else
//     { t: 'fx', id, kind, ... }               a relayed effect (sender id added)
//     { t: 'hit', from, ship, dmg, part }      to the host only
//     { t: 'bump', from, j, p, dmg, v, by, f }  to the owner of the struck boat only (from: the host)
//   state: wrecks { '<owner>:<id>': { owner, kind, model, x, y, z, yaw, pitch, roll, t, parts } } (t: the server's time of the add)
//   Rate rules (FireGate below): a cannon side fires a volley of at most CANNON_GATE.perVolley balls within ripple s, then
//   nothing until its reload; a firearm 'gunshot' event no faster than GUN_GATE x its reload; slower shots are dropped
//   welcome also carries { host, rides: [ { guest, host, seat } ], crew }
//   (wave 13)
//     { t: 'plane', op: 'set', id, kind, af, liv, up, p, q, thr } / { t: 'plane', op: 'del', id }   the sender's own planes
//                                              (kind 'stray': bailed out of, flying on; 'parked': the airframe out); state:
//                                              planes { '<owner>:<id>': { owner, kind, af, liv, up, x, y, z, qx, qy, qz, qw, thr, t } }
//     { t: 'fort', op: 'set', ... }            the HOST's Blackwater snapshot (sanitizeFort) -> state fort { seq, holder, by, byName,
//                                              claims, claimedAt, until, alarm, why, guards, shipsDown, castOff, open, batteries }
//     { t: 'fort', op: 'act', act, why }       a guest's hostile act -> { t: 'fortAct', from, act, why } to the host alone
//     { t: 'fort', op: 'claim' }               -> { t: 'fortClaim', ok, reason?, by?, claims? } (granted once, while open)
//     { t: 'ask', kind, data }                 a guest's request -> { t: 'ask', from, kind, data } to the host alone
//     event 'propsRespawned' { port, ids }     the host's batched prop respawns (clients expand them into propRespawned)
//     a player's state may carry chute: [ x, y, z, heading, open ] (under the parachute) and bw: 0 | 1 (near Blackwater: let in)
//
// Version 2 (the persistent universe; v1 clients still join the island and crew rooms):
//   client -> server
//     { t: 'event', kind, data }               a world event for everyone in the room (propDestroyed, trade...); never echoed
//   universe only (path /universe, a server started with --universe):
//     { t: 'hello', v: 2, name, character, boat, token, probe? }   token: 32 hex chars (128 bit, kept per server by the
//                                              browser); the server keeps the captain name -> sha256( token ); probe: answer
//                                              with 'profile' and close, nobody joins
//     { t: 'save', profile }                   the captain's GameState JSON (MAX_SAVE), 1 per 2 s
//     { t: 'market', sim }                     the host's trade market snapshot (MAX_MARKET), 1 per 5 s
//   server -> client
//     { t: 'event', kind, data, from, at }     from: the sender id, or 'server' (a respawn, a boat moored by a leaving captain)
//     { t: 'profile', captain, exists, profile, universe, players }   the answer to a probe
//     { t: 'saved', ok, at, fix?, reason? }    fix: { money?, xp? } the server clamped (anti-cheat): adopt it
//     { t: 'market', sim, at }                 the host's market, relayed to the other captains online (adopt it)
//     events from 'server': boatMoored { captain, name, boat, p, q, at } / boatUnmoored { captain } / propRespawned { id }
//     welcome adds { universe: { name, day, seed, bountySeed, createdAt }, captain, world: { events, boats, market, chat } }
//     clock adds { day, seed } in the universe; 'world' adds adopt: true for a new host taking over the stored ships
//   refusals (REFUSAL below): name (belongs to another token), banned, replaced (signed in elsewhere), nouniverse, badname,
//   token, kicked, plus 'size' (an oversized save, not fatal)
//   Unknown state fields (a seaplane's `plane`...) pass through to the others, cleaned (cleanData), within MAX_EXTRA.
//
// Positions are rounded to the centimetre, angles to 2 decimals, quaternions to 4; `at` is the server's
// Date.now(). sanitizeState / sanitizeHello / sanitizeChat return a clean copy or null when malformed.

import { CHARACTERS, DEFAULT_CHARACTER } from '../game/Characters.js';
import { BOATS } from '../game/Boats.js';

export const PROTOCOL_VERSION = 2;
export const MIN_PROTOCOL_VERSION = 1; // 2.1 clients still play the island and crews; the universe needs 2
export const SEND_HZ = 15;
export const MAX_NAME = 24;
export const MAX_CHAT = 200;
export const MAX_PLAYERS = 16;
export const MAX_FRAME = 4096; // bytes a single frame may hold
export const UNIVERSE_PATH = 'universe'; // ws://host:8765/universe
export const MAX_SAVE = 256 * 1024; // a captain's save frame
export const MAX_MARKET = 64 * 1024;
export const MAX_WIRE = 1024 * 1024; // what a client accepts from its server (a universe welcome carries the world)
export const MAX_EVENT_DATA = 2048; // JSON chars of a world event's data
export const MAX_EXTRA = 1024; // JSON chars of the unknown fields a state may carry
export const TOKEN_HEX = 32;
export const CHAT_KEEP = 100; // chat lines a universe keeps
export const RECONNECT_SECONDS = 60; // a dropped client keeps its seat (and id) this long

// refusals: the Colyseus error code of a refused join (the server's ServerError) and, for banned / replaced / kicked, the
// close code of a connection the server ends. Application range (4011..4999): Colyseus reserves 4000..4010
// (CONSENTED, SERVER_SHUTDOWN, WITH_ERROR, FAILED_TO_RECONNECT, MAY_TRY_RECONNECT ...).
export const REFUSAL = { full: 4101, hello: 4102, version: 4103, rooms: 4104, nocrew: 4105, name: 4106, banned: 4107, replaced: 4108, nouniverse: 4109, badname: 4110, token: 4111, kicked: 4112, rate: 4113 };
export const REFUSAL_OF = Object.fromEntries( Object.entries( REFUSAL ).map( ( [ k, v ] ) => [ v, k ] ) );
export const KICK_CLOSE = { 4107: 'banned', 4108: 'replaced', 4112: 'kicked' };
// a refusal while the room is being created travels as an HTTP status (Colyseus' matchmaking route): 409 no free room,
// 404 no such crew / universe
export const REFUSAL_HTTP = { rooms: 409, nocrew: 404, nouniverse: 404 };

// world events the universe persists (the others are only relayed). key: the data field naming the thing; ttl: seconds
// (ttlField: the sender may ask for another, clamped to min..max); expire: the kind the server sends when it runs out;
// clears: this kind removes the stored one of that kind; carry: data fields the expiry repeats (a respawn names the prop's port)
export const WORLD_EVENT_RULES = {
	propDestroyed: { key: 'id', ttl: 1800, min: 30, max: 86400, ttlField: 'respawn', expire: 'propRespawned', carry: [ 'port' ] },
	propRespawned: { key: 'id', clears: 'propDestroyed' },
	bountyClaimed: { key: 'id', ttl: 48 * 3600 },
};

// 'seat': sitting on your own boat; 'ride': a guest on another player's boat (the server fills in `ride` and `seat`)
export const MODES = [ 'walk', 'swim', 'deck', 'boat', 'seat', 'ride' ];
export const ACTIONS = [ 'cast', 'hold', 'reel', 'strike', 'celebrate', 'disappointed', 'wave', 'talk', 'dance', 'cheer', 'look', 'sitDown', 'seated' ];
export const DEFAULT_NAME = 'Fisher';
export const DEFAULT_ROOM = 'island';
export const CLOCK_START = 9.5; // h
export const CLOCK_SPEED = 0.01; // h per real second: a 40-minute day

export const CREW_CODE_LEN = 6;
export const CREW_LETTERS = 'abcdefghjkmnpqrstuvwxyz'; // generated codes skip i, l and o; typed codes may use any a-z
export const MAX_WORLD_SHIPS = 12;
export const MAX_HIT_DAMAGE = 60; // per hit message
export const RIDE_RANGE = 14; // m between a would-be guest and the host's boat
export const FX_KINDS = [ 'shot', 'hit', 'splash', 'sink', 'ram' ];
export const WORLD_HZ = 5;

const WORLD_LIMIT = 20000; // m; anything beyond is garbage
const SPEED_LIMIT = 200; // m/s

// ---- helpers

export function encode( msg ) {

	return JSON.stringify( msg );

}

// returns the parsed object or null (never throws); max: the longest text accepted
export function decode( text, max = MAX_FRAME ) {

	if ( typeof text !== 'string' ) {

		try {

			text = String( text );

		} catch ( e ) {

			return null;

		}

	}

	if ( text.length > max ) return null;
	try {

		const o = JSON.parse( text );
		return o && typeof o === 'object' && typeof o.t === 'string' ? o : null;

	} catch ( e ) {

		return null;

	}

}

const num = ( v, lo, hi, d = 0 ) => {

	if ( typeof v !== 'number' || ! Number.isFinite( v ) ) return Number.isFinite( d ) ? d : null;
	return v < lo ? lo : v > hi ? hi : v;

};

const round = ( v, p ) => Math.round( v * p ) / p;

// control characters (incl. zero-width / bidi marks) out, whitespace collapsed, length capped
export function cleanText( s, max ) {

	if ( typeof s !== 'string' ) return '';
	return s.replace( /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '' ).replace( /\s+/g, ' ' ).trim().slice( 0, max );

}

export function cleanName( s ) {

	const n = cleanText( s, MAX_NAME );
	return n.length ? n : DEFAULT_NAME;

}

const DATA_KEY = /^[A-Za-z_$][\w$.:-]{0,31}$/;
const BAD_KEYS = new Set( [ '__proto__', 'constructor', 'prototype' ] );

// plain JSON values only, cleaned: finite numbers (non-integers to 4 decimals), strings cleaned and capped at 200, at most
// 64 items / 32 keys per level and `depth` levels; anything else is undefined (dropped by the caller)
export function cleanData( v, depth = 4 ) {

	if ( v === null ) return null;
	switch ( typeof v ) {

		case 'boolean': return v;
		case 'number': return Number.isFinite( v ) ? ( Number.isInteger( v ) ? v : Math.round( v * 1e4 ) / 1e4 ) : undefined;
		case 'string': return cleanText( v, 200 );
		case 'object': {

			if ( depth <= 0 ) return undefined;
			if ( Array.isArray( v ) ) {

				const out = [];
				for ( let i = 0; i < v.length && i < 64; i ++ ) {

					const c = cleanData( v[ i ], depth - 1 );
					out.push( c === undefined ? null : c );

				}

				return out;

			}

			const out = {};
			let n = 0;
			for ( const k of Object.keys( v ) ) {

				if ( n >= 32 ) break;
				if ( ! DATA_KEY.test( k ) || BAD_KEYS.has( k ) ) continue;
				const c = cleanData( v[ k ], depth - 1 );
				if ( c === undefined ) continue;
				out[ k ] = c;
				n ++;

			}

			return out;

		}

		default: return undefined;

	}

}

// a world event: { kind, data } (data cleaned, at most MAX_EVENT_DATA JSON chars) or null
export function sanitizeEvent( o ) {

	if ( ! o || typeof o !== 'object' || typeof o.kind !== 'string' || ! /^[A-Za-z][\w.:-]{0,31}$/.test( o.kind ) ) return null;
	const data = o.data === undefined ? {} : cleanData( o.data );
	if ( data === undefined ) return null;
	if ( JSON.stringify( data ).length > MAX_EVENT_DATA ) return null;
	return { kind: o.kind, data };

}

// ---- universe identity

// a captain's name for the universe: 2..24 letters / digits / space . _ ' -, starting with a letter or digit; null otherwise
export function sanitizeCaptainName( s ) {

	const n = cleanText( s, MAX_NAME );
	if ( n.length < 2 || ! /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test( n ) ) return null;
	if ( [ 'server', 'admin', 'system', 'fisher', 'you' ].includes( captainKey( n ) ) ) return null;
	return n;

}

// the key a captain's name is stored under: case and width folded, spaces collapsed ("Mad  Meg" = "mad meg")
export function captainKey( name ) {

	return String( name || '' ).normalize( 'NFKC' ).toLowerCase().replace( /\s+/g, ' ' ).trim();

}

export function sanitizeToken( t ) {

	return typeof t === 'string' && new RegExp( `^[0-9a-f]{${ TOKEN_HEX }}$` ).test( t ) ? t : null;

}

// true for ws(s)://host[:port]/universe (or /<proxy prefix>/universe behind a TLS proxy)
export function isUniverseUrl( url ) {

	try {

		return /^wss?:$/.test( new URL( url ).protocol ) && /^\/(?:[^?#]*\/)?universe\/?$/i.test( new URL( url ).pathname );

	} catch ( e ) {

		return false;

	}

}

export function cleanCharacter( id ) {

	return typeof id === 'string' && CHARACTERS[ id ] ? id : DEFAULT_CHARACTER;

}

export function cleanBoat( id ) {

	return typeof id === 'string' && BOATS[ id ] ? id : null;

}

// { name, character, boat } or null when the hello is not a hello
export function sanitizeHello( o ) {

	if ( ! o || typeof o !== 'object' ) return null;
	return { name: cleanName( o.name ), character: cleanCharacter( o.character ), boat: cleanBoat( o.boat ) };

}

// the fields of a state this protocol knows; anything else is an extra (another feature's, e.g. `plane`)
const STATE_KEYS = new Set( [ 't', 'id', 'at', 'p', 'yaw', 'mode', 'speed', 'vy', 'grounded', 'diving', 'action', 'character', 'name', 'boat', 'ride', 'seat' ] );
const EXTRA_KEY = /^[a-z][A-Za-z0-9_]{0,23}$/;

// the extra fields of a state as one comparable string ('' when there are none)
export function stateExtras( s ) {

	let out = '';
	if ( ! s ) return out;
	for ( const k of Object.keys( s ) ) if ( ! STATE_KEYS.has( k ) ) out += k + '=' + JSON.stringify( s[ k ] ) + ';';
	return out;

}

// a clean state (numbers clamped and rounded, ids whitelisted) or null when it is malformed:
// non-finite numbers, an unknown mode, character or action, an oversized string anywhere.
// Unknown fields with a lowerCamel name are kept (cleanData, 3 levels) while they fit MAX_EXTRA together.
export function sanitizeState( o ) {

	if ( ! o || typeof o !== 'object' ) return null;
	const p = o.p;
	if ( ! Array.isArray( p ) || p.length !== 3 ) return null;
	for ( let i = 0; i < 3; i ++ ) if ( typeof p[ i ] !== 'number' || ! Number.isFinite( p[ i ] ) || Math.abs( p[ i ] ) > WORLD_LIMIT ) return null;
	if ( typeof o.yaw !== 'number' || ! Number.isFinite( o.yaw ) ) return null;
	if ( typeof o.mode !== 'string' || ! MODES.includes( o.mode ) ) return null;
	if ( o.action != null && ( typeof o.action !== 'string' || ! ACTIONS.includes( o.action ) ) ) return null;
	if ( o.character != null && ( typeof o.character !== 'string' || ! CHARACTERS[ o.character ] ) ) return null;
	if ( o.name != null && ( typeof o.name !== 'string' || o.name.length > MAX_NAME * 4 ) ) return null;
	const s = {
		ride: typeof o.ride === 'string' && /^[a-z0-9]{1,12}$/.test( o.ride ) ? o.ride : null,
		seat: Math.round( num( o.seat, 0, 7 ) ),
		p: [ round( p[ 0 ], 100 ), round( p[ 1 ], 100 ), round( p[ 2 ], 100 ) ],
		yaw: round( ( ( o.yaw + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI, 100 ),
		mode: o.mode,
		speed: round( num( o.speed, 0, SPEED_LIMIT ), 100 ),
		vy: round( num( o.vy, - SPEED_LIMIT, SPEED_LIMIT ), 100 ),
		grounded: o.grounded !== false,
		diving: o.diving === true,
		action: o.action || null,
		character: o.character || null,
		boat: null,
	};
	if ( o.name != null ) s.name = cleanName( o.name );
	if ( o.boat != null ) {

		const b = o.boat;
		if ( typeof b !== 'object' ) return null;
		if ( typeof b.id !== 'string' || ! BOATS[ b.id ] ) return null;
		const bp = b.p, bq = b.q;
		if ( ! Array.isArray( bp ) || bp.length !== 3 || ! Array.isArray( bq ) || bq.length !== 4 ) return null;
		for ( let i = 0; i < 3; i ++ ) if ( typeof bp[ i ] !== 'number' || ! Number.isFinite( bp[ i ] ) || Math.abs( bp[ i ] ) > WORLD_LIMIT ) return null;
		let len = 0;
		for ( let i = 0; i < 4; i ++ ) {

			if ( typeof bq[ i ] !== 'number' || ! Number.isFinite( bq[ i ] ) ) return null;
			len += bq[ i ] * bq[ i ];

		}

		if ( len < 1e-6 ) return null;
		len = 1 / Math.sqrt( len );
		s.boat = {
			id: b.id,
			p: [ round( bp[ 0 ], 100 ), round( bp[ 1 ], 100 ), round( bp[ 2 ], 100 ) ],
			q: [ round( bq[ 0 ] * len, 1e4 ), round( bq[ 1 ] * len, 1e4 ), round( bq[ 2 ] * len, 1e4 ), round( bq[ 3 ] * len, 1e4 ) ],
			throttle: round( num( b.throttle, - 1, 1 ), 100 ),
			steer: round( num( b.steer, - 1, 1 ), 100 ),
			rpm: round( num( b.rpm, - 10000, 10000 ), 1 ),
			driven: b.driven === true,
		};

	}

	// the extras another feature added (App.netState -> netsync.decorateState): passed through, bounded
	let room = MAX_EXTRA, n = 0;
	for ( const k of Object.keys( o ) ) {

		if ( STATE_KEYS.has( k ) || ! EXTRA_KEY.test( k ) || BAD_KEYS.has( k ) || n >= 8 ) continue;
		const v = k === 'helicopter' ? sanitizeHelicopter( o[ k ] ) : cleanData( o[ k ], 3 );
		if ( v === undefined ) continue;
		const len = JSON.stringify( v ).length + k.length;
		if ( len > room ) continue;
		room -= len;
		s[ k ] = v;
		n ++;

	}

	return s;

}

// Rotorcraft state is presentation only, but must never feed invalid transforms
// into another player's renderer. The server runs the same sanitizer.
export function sanitizeHelicopter( h ) {

	if ( h === null ) return null;
	if ( ! h || ! Array.isArray( h.p ) || h.p.length !== 3 || ! Array.isArray( h.q ) || h.q.length !== 4 ) return undefined;
	if ( ! h.p.every( v => Number.isFinite( v ) && Math.abs( v ) <= WORLD_LIMIT ) || ! h.q.every( Number.isFinite ) ) return undefined;
	const len = Math.hypot( ...h.q );
	if ( len < 1e-6 || ! Number.isFinite( len ) ) return undefined;
	return { p: h.p.map( v => round( v, 100 ) ), q: h.q.map( v => round( v / len, 1e4 ) ),
		rpm: round( num( h.rpm, 0, 1 ), 100 ), piloted: h.piloted === true,
		homeSlot: Math.round( num( h.homeSlot, 0, 15 ) ),
		...( h.lights === undefined ? {} : { lights: Math.round( num( h.lights, 0, 15, 0 ) ) } ) };

}

// the chat text, cleaned, or null when empty / not a string
export function sanitizeChat( o ) {

	if ( ! o || typeof o !== 'object' ) return null;
	if ( typeof o.text !== 'string' ) return null;
	const text = cleanText( o.text, MAX_CHAT );
	return text.length ? text : null;

}

// ---- crew codes, world snapshots, effects, hits

// a typed or generated crew code (6 letters, case-insensitive) or null
export function sanitizeCrewCode( s ) {

	s = typeof s === 'string' ? s.trim().toLowerCase() : '';
	return new RegExp( `^[a-z]{${ CREW_CODE_LEN }}$` ).test( s ) ? s : null;

}

// true for a room name that looks like a crew code and is not the default room
export function isCrewRoom( name ) {

	return name !== DEFAULT_ROOM && sanitizeCrewCode( name ) === name;

}

// a fresh code that `isTaken( code )` does not know; rnd is Math.random-like
export function makeCrewCode( isTaken = () => false, rnd = Math.random ) {

	for ( let n = 0; n < 200; n ++ ) {

		let c = '';
		for ( let i = 0; i < CREW_CODE_LEN; i ++ ) c += CREW_LETTERS[ Math.floor( rnd() * CREW_LETTERS.length ) ];
		if ( c !== DEFAULT_ROOM && ! isTaken( c ) ) return c;

	}

	return null;

}

// ws(s)://host:port/<room> for a crew code (keeps the host, the port and a proxy prefix of `url`)
export function crewUrl( url, code ) {

	const c = sanitizeCrewCode( code );
	if ( ! c ) return null;
	try {

		const u = new URL( url );
		const segs = u.pathname.split( '/' ).filter( Boolean );
		segs.pop();
		segs.push( c );
		u.pathname = '/' + segs.join( '/' );
		u.search = '';
		return u.toString();

	} catch ( e ) {

		return null;

	}

}

const vec = ( v, n, lim, p ) => {

	if ( ! Array.isArray( v ) || v.length !== n ) return null;
	const out = [];
	for ( let i = 0; i < n; i ++ ) {

		if ( typeof v[ i ] !== 'number' || ! Number.isFinite( v[ i ] ) || Math.abs( v[ i ] ) > lim ) return null;
		out.push( round( v[ i ], p ) );

	}

	return out;

};

const WORLD_NUMS = [ 'x', 'z', 'y', 's', 'hp', 'mx' ];

// the host's ship list: { ships: [ { id, k, n, x, z, y, s, hp, mx, st, r? } ] } or null. y is the heading (rad), s the speed (m/s).
export function sanitizeWorld( o ) {

	if ( ! o || typeof o !== 'object' || ! Array.isArray( o.ships ) ) return null;
	const ships = [];
	const seen = new Set();
	for ( const sh of o.ships ) {

		if ( ships.length >= MAX_WORLD_SHIPS ) break;
		if ( ! sh || typeof sh !== 'object' ) continue;
		const id = cleanText( sh.id, 24 );
		if ( ! id || seen.has( id ) || typeof sh.k !== 'string' || ! /^[a-z]{3,16}$/.test( sh.k ) ) continue;
		if ( typeof sh.st !== 'string' || ! /^[a-z]{2,12}$/.test( sh.st ) ) continue;
		if ( ! WORLD_NUMS.every( ( k ) => typeof sh[ k ] === 'number' && Number.isFinite( sh[ k ] ) ) ) continue;
		if ( Math.abs( sh.x ) > WORLD_LIMIT || Math.abs( sh.z ) > WORLD_LIMIT ) continue;
		seen.add( id );
		ships.push( {
			id, k: sh.k, n: cleanText( sh.n, 32 ), x: round( sh.x, 10 ), z: round( sh.z, 10 ),
			y: round( ( ( sh.y + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI, 100 ),
			s: round( num( sh.s, - 5, 40 ), 100 ), hp: round( num( sh.hp, 0, 5000 ), 10 ), mx: round( num( sh.mx, 1, 5000, 1 ), 10 ),
			st: sh.st, r: round( num( sh.r, 0, 1, 1 ), 100 ),
		} );

	}

	return { ships };

}

// a relayed effect: { kind, from?, dir?, v?, o?, big?, ship?, by?, x?, z? } or null. Shots carry the muzzle, the unit direction and the ball speed.
export function sanitizeFx( o ) {

	if ( ! o || typeof o !== 'object' || typeof o.kind !== 'string' || ! FX_KINDS.includes( o.kind ) ) return null;
	const fx = { kind: o.kind };
	if ( o.kind === 'shot' ) {

		const from = vec( o.from, 3, WORLD_LIMIT, 10 ), dir = vec( o.dir, 3, 2, 1000 );
		if ( ! from || ! dir ) return null;
		const l = Math.hypot( dir[ 0 ], dir[ 1 ], dir[ 2 ] );
		if ( l < 1e-3 ) return null;
		fx.from = from;
		fx.dir = [ round( dir[ 0 ] / l, 1000 ), round( dir[ 1 ] / l, 1000 ), round( dir[ 2 ] / l, 1000 ) ];
		fx.v = round( num( o.v, 20, 400, 120 ), 10 );
		fx.d = round( num( o.d, 0, MAX_HIT_DAMAGE, 0 ), 10 ); // damage the ball does to a boat it reaches (a ship's cannon: the receiver's own hull takes it)
		fx.o = cleanText( o.o, 24 ) || 'player';
		fx.big = o.big === true;
		fx.sd = o.sd === 'port' || o.sd === 'starboard' ? o.sd : '';
		if ( typeof o.c === 'string' && /^[\w-]{1,24}$/.test( o.c ) ) fx.c = o.c;
		return fx;

	}

	if ( o.kind === 'sink' ) {

		fx.ship = cleanText( o.ship, 24 );
		fx.by = cleanText( o.by, 12 );
		if ( ! fx.ship ) return null;

	}

	const x = num( o.x, - WORLD_LIMIT, WORLD_LIMIT, null ), z = num( o.z, - WORLD_LIMIT, WORLD_LIMIT, null );
	if ( o.kind !== 'sink' && ( x === null || z === null ) ) return null;
	if ( x !== null && z !== null ) {

		fx.x = round( x, 10 );
		fx.z = round( z, 10 );
		fx.y = round( num( o.y, - 200, 400, 0 ), 10 );

	}

	if ( o.kind === 'ram' ) fx.v = round( num( o.v, 0, 60, 0 ), 10 );
	return fx;

}

// a damage report from a guest to the host: { ship, dmg, part } or null (dmg clamped to MAX_HIT_DAMAGE)
export function sanitizeHit( o ) {

	if ( ! o || typeof o !== 'object' ) return null;
	const ship = cleanText( o.ship, 24 );
	if ( ! ship || typeof o.dmg !== 'number' || ! Number.isFinite( o.dmg ) || o.dmg <= 0 ) return null;
	return { ship, dmg: round( Math.min( o.dmg, MAX_HIT_DAMAGE ), 10 ), part: o.part === 'rigging' ? 'rigging' : 'hull' };

}

// ---- wave 11: hull collisions of remote boats, shared wrecks, fire rates

export const MAX_BUMP_DAMAGE = 2000; // hull points one blow may cost (a brigantine ramming a skiff takes most of it)
export const MAX_BUMP_IMPULSE = 2e6; // N s per component
export const BUMP_REACH = 12; // m: the contact must lie within the struck boat's half length + this of its last position
export const WRECK_KINDS = [ 'sinking', 'boat', 'plane' ];
export const MAX_WRECKS_PER_PLAYER = 4;
export const MAX_ROOM_WRECKS = 40;
const WRECK_ID = /^[\w.-]{1,24}$/;

// a hull collision the host resolved for player `to` (the impulse on that boat, the damage to its hull) or null
export function sanitizeBump( o ) {

	if ( ! o || typeof o !== 'object' || typeof o.to !== 'string' || ! /^[a-z0-9]{1,12}$/.test( o.to ) ) return null;
	const j = vec( o.j, 2, MAX_BUMP_IMPULSE, 10 ), p = vec( o.p, 2, WORLD_LIMIT, 100 );
	if ( ! j || ! p ) return null;
	const f = vec( o.f, 2, WORLD_LIMIT, 10 );
	return {
		to: o.to, j, p, dmg: round( num( o.dmg, 0, MAX_BUMP_DAMAGE, 0 ), 10 ), v: round( num( o.v, 0, 60, 0 ), 100 ),
		by: cleanText( o.by, 24 ), f: f || [ p[ 0 ], p[ 1 ] ],
	};

}

// a player's own wreck: { op: 'add', id, kind, model, x, y, z, yaw, pitch, roll, parts } | { op: 'del', id } | null
export function sanitizeWreck( o ) {

	if ( ! o || typeof o !== 'object' || typeof o.id !== 'string' || ! WRECK_ID.test( o.id ) ) return null;
	if ( o.op === 'del' ) return { op: 'del', id: o.id };
	if ( o.op !== 'add' || ! WRECK_KINDS.includes( o.kind ) ) return null;
	const model = typeof o.model === 'string' && /^[a-z][\w-]{0,23}$/.test( o.model ) ? o.model : null;
	if ( ! model || ( o.kind !== 'plane' && ! BOATS[ model ] ) ) return null;
	for ( const k of [ 'x', 'y', 'z' ] ) if ( typeof o[ k ] !== 'number' || ! Number.isFinite( o[ k ] ) || Math.abs( o[ k ] ) > WORLD_LIMIT ) return null;
	const ang = ( v ) => round( ( ( num( v, - 100, 100, 0 ) + Math.PI ) % ( 2 * Math.PI ) + 2 * Math.PI ) % ( 2 * Math.PI ) - Math.PI, 1000 );
	return {
		op: 'add', id: o.id, kind: o.kind, model, x: round( o.x, 100 ), y: round( num( o.y, - 400, 400 ), 100 ), z: round( o.z, 100 ),
		yaw: ang( o.yaw ), pitch: ang( o.pitch ), roll: ang( o.roll ), parts: Math.round( num( o.parts, 0, 0xffff, 0 ) ) & 0xffff,
	};

}

export const CANNON_GATE = { ripple: 1.2, perVolley: 6, reload: 1.5, shipReload: 3.5 }; // s; the fastest player battery reloads in ~1.9 s
export const GUN_GATE = 0.8; // a gunshot may follow the last of that weapon after this fraction of its reload (network jitter)

// Shots no faster than the weapon reloads (server/rooms.mjs; times in ms). Pure: the tests drive it with their own clock.
export class FireGate {

	constructor() {

		this.keys = new Map();

	}

	// a gun holding one ball: at most one shot per `reload` s
	single( key, now, reload ) {

		const last = this.keys.get( key );
		if ( last !== undefined && now - last < reload * 1000 ) return false;
		this.keys.set( key, now );
		return true;

	}

	// one ball of a battery side: up to perVolley balls within ripple s of the volley's first one, then none until reload s after it
	volley( key, now, { ripple = CANNON_GATE.ripple, perVolley = CANNON_GATE.perVolley, reload = CANNON_GATE.reload } = {} ) {

		const v = this.keys.get( key );
		if ( v && now - v.at < ripple * 1000 ) {

			if ( v.n >= perVolley ) return false;
			v.n ++;
			return true;

		}

		if ( v && now - v.at < Math.max( ripple, reload ) * 1000 ) return false;
		this.keys.set( key, { at: now, n: 1 } );
		return true;

	}

	// forget keys idle for `ms`
	prune( now, ms = 60000 ) {

		for ( const [ k, v ] of this.keys ) if ( now - ( typeof v === 'number' ? v : v.at ) > ms ) this.keys.delete( k );

	}

}

// ---- wave 13: shared planes, the Blackwater stronghold (host-authoritative), requests for the host

export const PLANE_KINDS = [ 'stray', 'parked' ]; // an abandoned plane flying on by itself / an airframe out at its base
export const MAX_PLANES_PER_PLAYER = 3;
export const MAX_ROOM_PLANES = 48;
export const PLANE_RATE = { n: 14, ms: 1000 }; // a stray streams at 10 Hz, a parked plane now and then
const PLANE_ID = /^[\w.-]{1,16}$/;

// a player's own plane entry: { op: 'set', id, kind, af, liv, up, p, q, thr } | { op: 'del', id } | null
// (af: the airframe id, liv: its livery, up: the fitted upgrades as one digit each, Airframes.UPGRADE_IDS order)
export function sanitizePlane( o ) {

	if ( ! o || typeof o !== 'object' || typeof o.id !== 'string' || ! PLANE_ID.test( o.id ) ) return null;
	if ( o.op === 'del' ) return { op: 'del', id: o.id };
	if ( o.op !== 'set' || ! PLANE_KINDS.includes( o.kind ) ) return null;
	const af = typeof o.af === 'string' && /^[a-z]{2,16}$/.test( o.af ) ? o.af : null;
	const p = vec( o.p, 3, WORLD_LIMIT, 100 ), q = vec( o.q, 4, 2, 1e4 );
	if ( ! af || ! p || ! q ) return null;
	const l = Math.hypot( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] );
	if ( l < 1e-3 ) return null;
	return {
		op: 'set', id: o.id, kind: o.kind, af, liv: Math.round( num( o.liv, 0, 15, 0 ) ), up: typeof o.up === 'string' && /^[0-9]{0,16}$/.test( o.up ) ? o.up : '',
		p, q: q.map( ( v ) => round( v / l, 1e4 ) ), thr: round( num( o.thr, 0, 2, 0 ), 100 ),
	};

}

export const FORT_HOLDERS = [ 'pirates', 'player' ];
export const FORT_ALARMS = [ 'calm', 'spotted', 'alarm' ];
export const FORT_ACTS = [ 'raise', 'hostile', 'guard' ]; // a guest's: the bell, a hostile in sight, a guard beaten
export const MAX_FORT_BATTERIES = 6;
export const FORT_CLAIM_EVERY = 1500; // ms between two claims of one player
const FORT_WORD = /^[A-Za-z][\w-]{0,23}$/;

// the stronghold messages:
//   { op: 'set', holder, claimedAt, until, alarm, why, guards, shipsDown, castOff, open, seen, batteries: [ { id, silenced,
//     why, platform, powder } ] }   the HOST's snapshot (claimedAt / until in game hours, -1 none; guards -1: no watch yet;
//     shipsDown / castOff: bits of the moored ships; open: claimable on the host; seen: the room's claim count it has applied)
//   { op: 'claim' }                 anybody: take the island (the server grants it once)
//   { op: 'act', act, why }         a guest's hostile act for the host's watch (FORT_ACTS)
export function sanitizeFort( o ) {

	if ( ! o || typeof o !== 'object' ) return null;
	if ( o.op === 'claim' ) return { op: 'claim' };
	const word = ( v ) => ( typeof v === 'string' && FORT_WORD.test( v ) ? v : '' );
	if ( o.op === 'act' ) return FORT_ACTS.includes( o.act ) ? { op: 'act', act: o.act, why: word( o.why ) } : null;
	if ( o.op !== 'set' || ! FORT_HOLDERS.includes( o.holder ) || ! FORT_ALARMS.includes( o.alarm ) ) return null;
	const bats = [];
	for ( const b of Array.isArray( o.batteries ) ? o.batteries : [] ) {

		if ( bats.length >= MAX_FORT_BATTERIES ) break;
		if ( ! b || typeof b !== 'object' || ! word( b.id ) || bats.some( ( x ) => x.id === b.id ) ) continue;
		bats.push( { id: b.id, silenced: b.silenced === true, why: word( b.why ), platform: b.platform === true, powder: b.powder === true } );

	}

	return {
		op: 'set', holder: o.holder, alarm: o.alarm, why: word( o.why ),
		claimedAt: round( num( o.claimedAt, - 1, 1e7, - 1 ), 100 ), until: round( num( o.until, - 1, 1e7, - 1 ), 100 ),
		guards: Math.round( num( o.guards, - 1, 30, - 1 ) ), shipsDown: Math.round( num( o.shipsDown, 0, 255, 0 ) ), castOff: Math.round( num( o.castOff, 0, 255, 0 ) ),
		open: o.open === true, seen: Math.round( num( o.seen, 0, 65535, 0 ) ), batteries: bats,
	};

}

// a guest asks the room's host to run something only the host may (a raid through naval.spawn...): { kind, data } or null
export function sanitizeAsk( o ) {

	return sanitizeEvent( o );

}

export function sanitizeRoom( path ) {

	const s = String( path || '' ).replace( /^\/+|\/+$/g, '' ).toLowerCase();
	return /^[a-z0-9_-]{1,32}$/.test( s ) ? s : DEFAULT_ROOM;

}

// ---- message builders (client side)

export function helloMessage( { name, character, boat } ) {

	return { t: 'hello', v: PROTOCOL_VERSION, name: cleanName( name ), character: cleanCharacter( character ), boat: cleanBoat( boat ) };

}

// true when two sanitized states differ beyond the wire's own rounding (so the sender can skip a frame)
export function stateChanged( a, b ) {

	if ( ! a || ! b ) return true;
	if ( a.mode !== b.mode || a.ride !== b.ride || a.seat !== b.seat || a.action !== b.action || a.character !== b.character || a.grounded !== b.grounded || a.diving !== b.diving ) return true;
	if ( a.name !== b.name ) return true;
	if ( Math.abs( a.p[ 0 ] - b.p[ 0 ] ) > 0.005 || Math.abs( a.p[ 1 ] - b.p[ 1 ] ) > 0.005 || Math.abs( a.p[ 2 ] - b.p[ 2 ] ) > 0.005 ) return true;
	if ( Math.abs( a.yaw - b.yaw ) > 0.005 || Math.abs( a.speed - b.speed ) > 0.02 || Math.abs( a.vy - b.vy ) > 0.02 ) return true;
	if ( ! a.boat !== ! b.boat ) return true;
	if ( a.boat ) {

		const x = a.boat, y = b.boat;
		if ( x.id !== y.id || x.driven !== y.driven ) return true;
		for ( let i = 0; i < 3; i ++ ) if ( Math.abs( x.p[ i ] - y.p[ i ] ) > 0.005 ) return true;
		for ( let i = 0; i < 4; i ++ ) if ( Math.abs( x.q[ i ] - y.q[ i ] ) > 0.0005 ) return true;
		if ( Math.abs( x.throttle - y.throttle ) > 0.01 || Math.abs( x.steer - y.steer ) > 0.01 || Math.abs( x.rpm - y.rpm ) > 5 ) return true;

	}

	return stateExtras( a ) !== stateExtras( b );

}

// time of day of a clock message at local time `now` (ms, same epoch as clock.at)
export function clockTimeOfDay( clock, now = Date.now() ) {

	if ( ! clock ) return CLOCK_START;
	return ( ( clock.timeOfDay + ( now - clock.at ) / 1000 * clock.timeSpeed ) % 24 + 24 ) % 24;

}
