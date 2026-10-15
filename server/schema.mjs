// The synchronized state of a Hyptile Island room (@colyseus/schema 5, patched to the clients at SEND_HZ). The browser
// decodes it by reflection (@colyseus/sdk), so these classes live on the server only. src/net/ColyseusLink.js
// reads a Player back into the state object of src/net/Protocol.js (sanitizeState): p = [ x, y, z ], boat = { id, p, q, ... }.
//
//   HyptileState { room, crew, universe, host, at, players: { id: Player }, ships: [ Ship ], shipsAt, shipsHost,
//                  moored: { captainKey: Moored }, clock: Clock, wrecks: { '<owner>:<id>': Wreck },
//                  planes: { '<owner>:<id>': PlaneEntry }, fort: Fort { ..., batteries: { id: FortBattery } } }
//   Player       profile fields (bumped `profile` on a hello) + the newest accepted state (bumped `seq`)

import { schema, t } from '@colyseus/schema';

export const Boat = schema( {
	id: t.string().default( '' ), // '' while the player is not aboard
	x: t.float32().default( 0 ), y: t.float32().default( 0 ), z: t.float32().default( 0 ),
	qx: t.float32().default( 0 ), qy: t.float32().default( 0 ), qz: t.float32().default( 0 ), qw: t.float32().default( 1 ),
	throttle: t.float32().default( 0 ), steer: t.float32().default( 0 ), rpm: t.float32().default( 0 ),
	driven: t.boolean().default( false ),
}, 'Boat' );

export const Player = schema( {
	id: t.string().default( '' ),
	name: t.string().default( '' ),
	character: t.string().default( '' ),
	owned: t.string().default( '' ), // the boat they own ('' none); `boat` below is the one they are aboard
	captain: t.string().default( '' ), // the universe captain key
	open: t.boolean().default( true ), // takes guests
	profile: t.uint16().default( 0 ), // bumped by a hello (a profile update reads as a 'join')
	seq: t.uint32().default( 0 ), // bumped by every accepted state
	has: t.boolean().default( false ), // a state arrived
	mode: t.string().default( 'walk' ),
	x: t.float32().default( 0 ), y: t.float32().default( 0 ), z: t.float32().default( 0 ),
	yaw: t.float32().default( 0 ), speed: t.float32().default( 0 ), vy: t.float32().default( 0 ),
	grounded: t.boolean().default( true ), diving: t.boolean().default( false ),
	action: t.string().default( '' ),
	ride: t.string().default( '' ), seat: t.uint8().default( 0 ),
	boat: t.ref( Boat ),
	extra: t.string().default( '' ), // the other features' fields of the state (cleanData), as JSON
}, 'Player' );

export const Ship = schema( {
	id: t.string().default( '' ), k: t.string().default( '' ), n: t.string().default( '' ), st: t.string().default( '' ),
	x: t.float32().default( 0 ), z: t.float32().default( 0 ), y: t.float32().default( 0 ), s: t.float32().default( 0 ),
	hp: t.float32().default( 0 ), mx: t.float32().default( 1 ), r: t.float32().default( 1 ),
}, 'Ship' );

export const Moored = schema( {
	captain: t.string().default( '' ), name: t.string().default( '' ), boat: t.string().default( '' ),
	x: t.float32().default( 0 ), y: t.float32().default( 0 ), z: t.float32().default( 0 ),
	qx: t.float32().default( 0 ), qy: t.float32().default( 0 ), qz: t.float32().default( 0 ), qw: t.float32().default( 1 ),
	at: t.float64().default( 0 ),
}, 'Moored' );

export const Clock = schema( {
	timeOfDay: t.float64().default( 0 ), timeSpeed: t.float64().default( 0 ), at: t.float64().default( 0 ),
	day: t.int32().default( - 1 ), // -1 outside a universe
	seed: t.float64().default( 0 ),
}, 'Clock' );

// a player's wreck (wave 11): a boat going down ('sinking'), on the sea floor ('boat') or a seaplane's ('plane', parts: the bits of
// the pieces torn off, src/features/netsync/WreckLink.js). Created and removed by its owner; gone when the owner leaves.
export const Wreck = schema( {
	owner: t.string().default( '' ), kind: t.string().default( '' ), model: t.string().default( '' ),
	x: t.float32().default( 0 ), y: t.float32().default( 0 ), z: t.float32().default( 0 ),
	yaw: t.float32().default( 0 ), pitch: t.float32().default( 0 ), roll: t.float32().default( 0 ),
	t: t.float64().default( 0 ), parts: t.uint16().default( 0 ),
}, 'Wreck' );

// wave 13: a player's plane that is not under her (a 'stray' flying on after a bail-out, streamed by its owner until it wrecks;
// a 'parked' airframe out at its base or left at sea). Created and removed by its owner; gone when the owner leaves.
export const PlaneEntry = schema( {
	owner: t.string().default( '' ), kind: t.string().default( '' ), af: t.string().default( 'jade' ), liv: t.uint8().default( 0 ), up: t.string().default( '' ),
	x: t.float32().default( 0 ), y: t.float32().default( 0 ), z: t.float32().default( 0 ),
	qx: t.float32().default( 0 ), qy: t.float32().default( 0 ), qz: t.float32().default( 0 ), qw: t.float32().default( 1 ),
	thr: t.float32().default( 0 ), t: t.float64().default( 0 ),
}, 'PlaneEntry' );

// wave 13: the Blackwater stronghold, host-authoritative (src/features/netsync/StrongholdLink.js). The host writes everything
// but the claim, which the server grants once (holder, by, claims); a host snapshot that has not seen the newest claim
// (seen < claims) cannot hand the island back to the pirates.
export const FortBattery = schema( {
	silenced: t.boolean().default( false ), why: t.string().default( '' ), platform: t.boolean().default( false ), powder: t.boolean().default( false ),
}, 'FortBattery' );

export const Fort = schema( {
	seq: t.uint32().default( 0 ), // host snapshots applied (0: no host runs the stronghold yet)
	holder: t.string().default( 'pirates' ), by: t.string().default( '' ), byName: t.string().default( '' ), claims: t.uint16().default( 0 ),
	claimedAt: t.float64().default( - 1 ), until: t.float64().default( - 1 ), // game hours (the host's clock)
	alarm: t.string().default( 'calm' ), why: t.string().default( '' ),
	guards: t.int8().default( - 1 ), shipsDown: t.uint8().default( 0 ), castOff: t.uint8().default( 0 ), open: t.boolean().default( false ),
	batteries: t.map( FortBattery ),
}, 'Fort' );

export const HyptileState = schema( {
	room: t.string().default( '' ),
	crew: t.boolean().default( false ),
	universe: t.string().default( '' ), // the universe's name ('' for a plain / crew room)
	host: t.string().default( '' ), // the world host's id
	at: t.float64().default( 0 ), // server Date.now() of the newest state change (the 'states' at)
	players: t.map( Player ),
	ships: t.array( Ship ),
	shipsAt: t.float64().default( 0 ),
	shipsHost: t.string().default( '' ),
	moored: t.map( Moored ),
	clock: t.ref( Clock ),
	wrecks: t.map( Wreck ),
	planes: t.map( PlaneEntry ),
	fort: t.ref( Fort ),
}, 'HyptileState' );

const r2 = ( v ) => Math.round( v * 100 ) / 100;

// a sanitized state (Protocol.sanitizeState) into a Player
export function writePlayerState( pl, s ) {

	pl.has = true;
	pl.mode = s.mode;
	pl.x = s.p[ 0 ]; pl.y = s.p[ 1 ]; pl.z = s.p[ 2 ];
	pl.yaw = s.yaw; pl.speed = s.speed; pl.vy = s.vy;
	pl.grounded = s.grounded; pl.diving = s.diving;
	pl.action = s.action || '';
	pl.ride = s.ride || '';
	pl.seat = s.seat | 0;
	if ( s.character ) pl.character = s.character;
	const b = pl.boat;
	if ( s.boat ) {

		const sb = s.boat;
		b.id = sb.id;
		b.x = sb.p[ 0 ]; b.y = sb.p[ 1 ]; b.z = sb.p[ 2 ];
		b.qx = sb.q[ 0 ]; b.qy = sb.q[ 1 ]; b.qz = sb.q[ 2 ]; b.qw = sb.q[ 3 ];
		b.throttle = sb.throttle; b.steer = sb.steer; b.rpm = sb.rpm; b.driven = sb.driven;

	} else if ( b.id ) b.id = '';

	pl.extra = extrasJSON( s );
	pl.seq = ( pl.seq + 1 ) >>> 0;

}

const KNOWN = new Set( [ 't', 'id', 'at', 'p', 'yaw', 'mode', 'speed', 'vy', 'grounded', 'diving', 'action', 'character', 'name', 'boat', 'ride', 'seat' ] );

function extrasJSON( s ) {

	let out = null;
	for ( const k of Object.keys( s ) ) {

		if ( KNOWN.has( k ) ) continue;
		( out || ( out = {} ) )[ k ] = s[ k ];

	}

	return out ? JSON.stringify( out ) : '';

}

// the ship list of Protocol.sanitizeWorld into the ArraySchema (in place: unchanged ships cost nothing in the patch)
export function writeShips( arr, ships ) {

	for ( let i = 0; i < ships.length; i ++ ) {

		let sh = arr[ i ];
		if ( ! sh ) arr.push( sh = new Ship() );
		const s = ships[ i ];
		sh.id = s.id; sh.k = s.k; sh.n = s.n || ''; sh.st = s.st;
		sh.x = s.x; sh.z = s.z; sh.y = s.y; sh.s = s.s; sh.hp = s.hp; sh.mx = s.mx; sh.r = s.r ?? 1;

	}

	while ( arr.length > ships.length ) arr.pop();

}

// back out (the same rounding the protocol uses)
export function readShips( arr ) {

	const out = [];
	for ( const sh of arr ) {

		out.push( {
			id: sh.id, k: sh.k, n: sh.n, x: Math.round( sh.x * 10 ) / 10, z: Math.round( sh.z * 10 ) / 10, y: r2( sh.y ), s: r2( sh.s ),
			hp: Math.round( sh.hp * 10 ) / 10, mx: Math.round( sh.mx * 10 ) / 10, st: sh.st, r: r2( sh.r ),
		} );

	}

	return out;

}

export function writeMoored( map, m ) {

	let e = map.get( m.captain );
	if ( ! e ) e = new Moored();
	e.captain = m.captain; e.name = m.name || ''; e.boat = m.boat || '';
	e.x = m.p[ 0 ] || 0; e.y = m.p[ 1 ] || 0; e.z = m.p[ 2 ] || 0;
	const q = Array.isArray( m.q ) ? m.q : [ 0, 0, 0, 1 ];
	e.qx = q[ 0 ] || 0; e.qy = q[ 1 ] || 0; e.qz = q[ 2 ] || 0; e.qw = q[ 3 ] ?? 1;
	e.at = m.at || 0;
	map.set( m.captain, e );

}

// a sanitized wreck (Protocol.sanitizeWreck, op 'add') into the map under '<owner>:<id>'; t is kept from the first add
export function writeWreck( map, owner, w, now = Date.now() ) {

	const key = owner + ':' + w.id;
	let e = map.get( key );
	const fresh = ! e;
	if ( fresh ) e = new Wreck();
	const changed = fresh || e.kind !== w.kind; // (a boat that went down: the wreck's clock starts again)
	e.owner = owner; e.kind = w.kind; e.model = w.model;
	e.x = w.x; e.y = w.y; e.z = w.z; e.yaw = w.yaw; e.pitch = w.pitch; e.roll = w.roll; e.parts = w.parts;
	if ( changed ) e.t = now;
	if ( fresh ) map.set( key, e );
	return key;

}

// a sanitized plane (Protocol.sanitizePlane, op 'set') into the map under '<owner>:<id>'; t is the server's time of the first set
export function writePlane( map, owner, e, now = Date.now() ) {

	const key = owner + ':' + e.id;
	let pe = map.get( key );
	const fresh = ! pe;
	if ( fresh ) pe = new PlaneEntry();
	if ( fresh || pe.kind !== e.kind ) pe.t = now;
	pe.owner = owner; pe.kind = e.kind; pe.af = e.af; pe.liv = e.liv; pe.up = e.up;
	pe.x = e.p[ 0 ]; pe.y = e.p[ 1 ]; pe.z = e.p[ 2 ];
	pe.qx = e.q[ 0 ]; pe.qy = e.q[ 1 ]; pe.qz = e.q[ 2 ]; pe.qw = e.q[ 3 ];
	pe.thr = e.thr;
	if ( fresh ) map.set( key, pe );
	return key;

}

// the host's stronghold snapshot (Protocol.sanitizeFort, op 'set') into the Fort; the holder only follows a host that has seen
// every claim the server granted (else a snapshot made before the claim reached the host would undo it)
export function writeFort( f, s ) {

	if ( s.seen === f.claims ) {

		if ( s.holder === 'pirates' && f.holder === 'player' ) { f.holder = 'pirates'; f.by = ''; f.byName = ''; }
		if ( f.holder === 'player' ) { f.claimedAt = s.claimedAt; f.until = s.until; } else { f.claimedAt = - 1; f.until = - 1; }

	}

	f.alarm = s.alarm; f.why = s.why;
	f.guards = s.guards; f.shipsDown = s.shipsDown; f.castOff = s.castOff; f.open = s.open;
	const keep = new Set();
	for ( const b of s.batteries ) {

		keep.add( b.id );
		let e = f.batteries.get( b.id );
		if ( ! e ) f.batteries.set( b.id, e = new FortBattery() );
		e.silenced = b.silenced; e.why = b.why; e.platform = b.platform; e.powder = b.powder;

	}

	for ( const id of [ ...f.batteries.keys() ] ) if ( ! keep.has( id ) ) f.batteries.delete( id );
	f.seq = ( f.seq + 1 ) >>> 0;

}

// the Fort as a plain object (the admin console, the tests)
export function readFort( f ) {

	const batteries = {};
	f.batteries.forEach( ( b, id ) => { batteries[ id ] = { silenced: b.silenced, why: b.why, platform: b.platform, powder: b.powder }; } );
	return {
		seq: f.seq, holder: f.holder, by: f.by, byName: f.byName, claims: f.claims, claimedAt: f.claimedAt, until: f.until, alarm: f.alarm, why: f.why,
		guards: f.guards, shipsDown: f.shipsDown, castOff: f.castOff, open: f.open, batteries,
	};

}

// a stored Fort (Universe.state.fort, written by readFort) back into the room's schema after a restart: the holder, the
// claim and the batteries; the watch starts calm and `by` empty (session ids do not survive). The next host's stronghold
// adopts the claim (StrongholdLink: claims > seen), its snapshots carry on from there.
export function restoreFort( f, s ) {

	if ( ! s || typeof s !== 'object' ) return false;
	const str = ( v, d = '' ) => ( typeof v === 'string' ? v.slice( 0, 64 ) : d );
	const num = ( v, d ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
	f.holder = s.holder === 'player' ? 'player' : 'pirates';
	f.by = '';
	f.byName = f.holder === 'player' ? str( s.byName ) : '';
	f.claims = num( s.claims, 0 ) & 0xffff;
	f.claimedAt = f.holder === 'player' ? num( s.claimedAt, - 1 ) : - 1;
	f.until = f.holder === 'player' ? num( s.until, - 1 ) : - 1;
	f.alarm = 'calm';
	f.why = '';
	f.guards = Math.max( - 1, Math.min( 30, num( s.guards, - 1 ) | 0 ) );
	f.shipsDown = num( s.shipsDown, 0 ) & 0xff;
	f.castOff = 0; // (the ships are back at their moorings)
	f.open = false;
	f.batteries.clear();
	const bats = s.batteries && typeof s.batteries === 'object' ? s.batteries : {};
	for ( const id of Object.keys( bats ).slice( 0, 32 ) ) {

		const b = bats[ id ] || {}, e = new FortBattery();
		e.silenced = b.silenced === true; e.why = str( b.why ); e.platform = b.platform === true; e.powder = b.powder === true;
		f.batteries.set( id, e );

	}

	f.seq = Math.max( 1, num( s.seq, 1 ) >>> 0 ); // (> 0: the guests apply it before a host runs the stronghold again)
	return true;

}
