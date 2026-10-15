#!/usr/bin/env node
// Hyptile Island server on Colyseus 0.18 (@colyseus/core + @colyseus/ws-transport, state in @colyseus/schema): the plain and
// crew rooms, the persistent universe, GET /health and the admin console.
//
//   node server/index.mjs [--port 8765] [--host 0.0.0.0] [--room-cap 16] [--max-rooms 64] [--reconnect-seconds 60]
//   node server/index.mjs --universe hyptile [--data server-data/hyptile] [--max-players 16] [--backup-days 14]
//
// Clients (src/net/NetClient.js over @colyseus/sdk) talk HTTP + WebSocket to this one port: POST /matchmake/... picks the room,
// the socket joins it. Rooms (server/rooms.mjs): 'room' is any named room (ws://host:8765/island is the default; any path is a
// room) and the crew rooms (6 letters, reserved by a 'createCrew' message, an unknown code is refused with 'nocrew'; at most
// --max-rooms rooms exist); 'universe' is the persistent universe at ws://host:8765/universe when started with --universe
// (server/universe.mjs: captains = name + sha256 of their browser's token, saved games, world events with respawn timers,
// offline captains' moored boats, the shared market, the chat log and the pirates, written to --data every ~10 s, on shutdown
// and copied to a daily backup; its clock runs from the universe's creation, online or not). The room's host (the oldest
// connected player, migrating when they leave or drop) alone may send 'world' (AI ships); the server relays shots ('fx'),
// forwards damage reports ('hit') to the host and seats guests on a host's boat ('ride': range / capacity / policy checked).
// A dropped client keeps its seat --reconnect-seconds. The console (stdin) takes admin commands: help, list, captains, kick,
// ban, unban, release, save, backup, announce, stop. The message vocabulary lives in src/net/Protocol.js.
//
// A public host (the shared universe on Fly.io, docs/HOSTING.md) has no console: with --admin-token (or ADMIN_TOKEN) the
// HTTP routes GET /admin/stats, POST /admin/save, POST /admin/backup and POST /admin/command { line } (any console command
// but stop) answer a request carrying `Authorization: Bearer <token>`; without a token they do not exist (404). The console
// itself is only read from a terminal (a container's stdin is not one). /health carries `build`: the game's commit
// (BUILD_HASH, written by the deploy) so a browser can tell a server that is still updating from one that refuses it.
//
// One server per process (Colyseus' matchmaker is a module singleton). `startServer( opts )` is exported for tests (close()
// it before starting the next); `attachConsole` / `stopOnSignals` for launchers. One PC needs no Colyseus presence / Redis
// driver (docs/HOSTING.md has the note on scaling).

import http from 'node:http';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { defineServer, defineRoom, unregisterRoomDefinitions, matchMaker, createRouter, createEndpoint } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
	PROTOCOL_VERSION, SEND_HZ, MAX_PLAYERS, MAX_SAVE, UNIVERSE_PATH, RECONNECT_SECONDS, captainKey, cleanText,
} from '../src/net/Protocol.js';
import { Universe } from './universe.mjs';
import { makeRooms } from './rooms.mjs';

let active = null; // the running server of this process

export function startServer( options = {} ) {

	if ( active ) throw new Error( 'a Hyptile Island server is already running in this process: close() it first' );
	const opts = {
		port: 8765, host: '0.0.0.0', roomCap: MAX_PLAYERS,
		tickHz: SEND_HZ, clockEveryMs: 10000, pingMs: 3000, pingRetries: 3,
		maxRooms: 64, emptyMs: 30000, crewHoldMs: 120000, crewPerAddress: 4, crewEveryMs: 3000,
		universe: null, data: null, universeCap: MAX_PLAYERS, flushMs: 10000, backupDays: 14, saveEveryMs: 2000, marketEveryMs: 5000,
		newCaptainsPerHour: 5, reconnectSeconds: RECONNECT_SECONDS,
		build: process.env.BUILD_HASH || 'dev', // the game commit this server was deployed with (deploy-universe.yml)
		adminToken: null, // the admin HTTP routes' bearer token (null: no admin routes)
		log: ( ...a ) => console.log( new Date().toISOString(), ...a ),
		...options,
	};
	const ctx = { opts, universe: null, rooms: new Map(), creating: new Set(), closing: false };

	// the persistent universe (one per server)
	if ( opts.universe ) {

		ctx.universe = new Universe( { name: opts.universe, dir: opts.data, log: opts.log, backupDays: opts.backupDays } ).load();
		ctx.universe.newPerHour = opts.newCaptainsPerHour;

	}

	const universe = ctx.universe;
	const uniRoom = () => ctx.rooms.get( UNIVERSE_PATH ) || null;
	const health = () => {

		const body = { ok: true, version: PROTOCOL_VERSION, build: String( opts.build || 'dev' ).slice( 0, 40 ), transport: 'colyseus', uptime: Math.round( process.uptime() ), players: 0, rooms: {} };
		for ( const r of ctx.rooms.values() ) {

			const n = r.connected().length;
			body.rooms[ r.label ] = { players: n, timeOfDay: r.dayClock().timeOfDay };
			body.players += n;

		}

		if ( universe ) body.universe = { ...universe.info(), players: uniRoom() ? uniRoom().connected().length : 0, cap: opts.universeCap, captains: Object.keys( universe.state.captains ).length };
		return body;

	};

	const json = ( body, status = 200 ) => new Response( JSON.stringify( body ), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } } ); // (CORS: Colyseus adds it)
	// the admin routes: only with a token, only with that token (compared in constant time); a wrong one costs half a second
	const digest = ( v ) => createHash( 'sha256' ).update( String( v ) ).digest();
	const adminRoute = ( fn ) => async ( c ) => {

		if ( ! opts.adminToken ) return json( { ok: false, error: 'not found' }, 404 );
		const m = /^Bearer\s+(\S+)\s*$/i.exec( String( ( c.getHeader && c.getHeader( 'authorization' ) ) || '' ) );
		if ( ! m || ! timingSafeEqual( digest( m[ 1 ] ), digest( opts.adminToken ) ) ) {

			await new Promise( ( r ) => setTimeout( r, 500 ) );
			return json( { ok: false, error: 'unauthorized' }, 401 );

		}

		try {

			return json( { ok: true, ...( await fn( c ) ) } );

		} catch ( e ) {

			return json( { ok: false, error: e && e.message || String( e ) }, 500 );

		}

	};
	const adminStats = () => {

		const mem = process.memoryUsage();
		const body = { ...health(), memoryMB: Math.round( mem.rss / 1048576 ), online: [] };
		for ( const r of ctx.rooms.values() ) for ( const m of r.order.values() ) body.online.push( { room: r.label, id: m.id, name: m.name, captain: !! m.captainKey, dropped: !! m.dropped } );
		if ( universe ) body.data = { dir: universe.dir, savedAt: universe.state.savedAt, fort: universe.state.fort ? universe.state.fort.holder : null };
		return body;

	};
	const quiet = () => {};
	const warn = ( ...a ) => opts.log( 'colyseus:', ...a );
	const server = http.createServer();
	// a universe save may be MAX_SAVE; anything bigger than twice that is cut by ws itself (close 1009)
	const transport = new WebSocketTransport( { server, maxPayload: MAX_SAVE * 2, pingInterval: opts.pingMs, pingMaxRetries: opts.pingRetries } );
	const { HyptileRoom, UniverseRoom } = makeRooms( ctx );
	const rooms = { room: defineRoom( HyptileRoom ).filterBy( [ 'room' ] ) }; // joinOrCreate by name; crews by id
	if ( universe ) rooms.universe = defineRoom( UniverseRoom ); // joinById 'universe'
	// (signals are ours: stopOnSignals saves the universe first; the console logger stays quiet)
	const gs = defineServer( {
		rooms,
		routes: createRouter( {
			health: createEndpoint( '/health', { method: 'GET' }, async () => json( health() ) ),
			root: createEndpoint( '/', { method: 'GET' }, async () => json( health() ) ),
			adminStats: createEndpoint( '/admin/stats', { method: 'GET' }, adminRoute( () => adminStats() ) ),
			adminSave: createEndpoint( '/admin/save', { method: 'POST' }, adminRoute( () => ( { answer: admin( 'save' ) } ) ) ),
			adminBackup: createEndpoint( '/admin/backup', { method: 'POST' }, adminRoute( () => ( { answer: admin( 'backup' ) } ) ) ),
			adminCommand: createEndpoint( '/admin/command', { method: 'POST' }, adminRoute( ( c ) => {

				let b = c.body;
				if ( typeof b === 'string' ) {

					try { b = JSON.parse( b ); } catch ( e ) { b = { line: b }; }

				}

				const line = String( b && b.line || '' ).slice( 0, 400 );
				if ( /^\s*(stop|quit|exit)\b/i.test( line ) ) return { answer: 'stop is not an HTTP command: a deploy or a machine restart saves and restarts the server' };
				return { answer: admin( line ) };

			} ) ),
		} ),
		transport, greet: false, gracefullyShutdown: false,
		logger: { debug: quiet, trace: quiet, info: quiet, log: quiet, warn, error: warn },
	} );

	const flushTimer = universe ? setInterval( () => {

		try {

			universe.flush();

		} catch ( e ) {

			opts.log( `universe: flush failed: ${ e.message }` );

		}

	}, opts.flushMs ) : 0;

	const srv = { server, gs, rooms: ctx.rooms, opts, universe, ctx, ready: null, close: null, admin: null, get port() { return server.address() ? server.address().port : opts.port; } };
	active = srv;

	// ---- admin commands (the console; also callable from tests): returns the answer as text

	const everyone = () => {

		const out = [];
		for ( const r of ctx.rooms.values() ) for ( const m of r.order.values() ) out.push( { room: r, m } );
		return out;

	};
	const findClient = ( name ) => {

		const k = captainKey( name );
		return everyone().find( ( { m } ) => captainKey( m.name ) === k || m.id === name || m.captainKey === k ) || null;

	};
	const admin = ( line ) => {

		const [ cmd = '', ...rest ] = String( line || '' ).trim().split( /\s+/ );
		const arg = rest.join( ' ' );
		switch ( cmd.toLowerCase() ) {

			case '': return '';
			case 'help': case '?':
				return [
					'list                 who is online (every room)',
					'wrecks               the wrecks the rooms show (sinking boats, boats on the bottom, seaplanes)',
					'planes               the planes flying on by themselves (stray) and parked, per room',
					'fort                 the Blackwater stronghold of each room (holder, alarm, batteries, guards)',
					'captains             every captain of the universe',
					'kick <name>          disconnect a player (they may come back)',
					'ban <name> [reason]  ban a captain from the universe (and kick)',
					'unban <name>         lift a ban',
					'release <name>       free a name whose browser was lost (the next to join with it owns it)',
					'save                 write the universe to disk now',
					'backup               make a backup copy now',
					'announce <text>      a server message in every chat',
					'stop                 save and shut the server down',
				].join( '\n' );
			case 'list': {

				const lines = everyone().map( ( { room, m } ) => `${ room.label.padEnd( 10 ) } ${ m.id } ${ m.name }${ m.captainKey ? ' (captain)' : '' } from ${ m.remote }${ m.dropped ? ' (reconnecting)' : '' }` );
				return lines.length ? lines.join( '\n' ) : 'nobody online';

			}

			case 'wrecks': {

				const lines = [];
				for ( const r of ctx.rooms.values() ) r.state.wrecks.forEach( ( w, key ) => {

					const m = r.order.get( w.owner );
					lines.push( `${ r.label.padEnd( 10 ) } ${ key.padEnd( 32 ) } ${ w.kind.padEnd( 8 ) } ${ w.model.padEnd( 10 ) } at ${ Math.round( w.x ) }, ${ Math.round( w.z ) }  ${ m ? m.name : '?' }` );

				} );
				return lines.length ? lines.join( '\n' ) : 'no wrecks';

			}

			case 'planes': {

				const lines = [];
				for ( const r of ctx.rooms.values() ) r.state.planes.forEach( ( e, key ) => {

					const m = r.order.get( e.owner );
					lines.push( `${ r.label.padEnd( 10 ) } ${ key.padEnd( 24 ) } ${ e.kind.padEnd( 7 ) } ${ e.af.padEnd( 10 ) } at ${ Math.round( e.x ) }, ${ Math.round( e.y ) }, ${ Math.round( e.z ) }  ${ m ? m.name : '?' }` );

				} );
				return lines.length ? lines.join( '\n' ) : 'no planes';

			}

			case 'fort': {

				const lines = [];
				for ( const r of ctx.rooms.values() ) {

					const f = r.state.fort;
					if ( ! f.seq && f.holder === 'pirates' ) continue;
					const bats = [];
					f.batteries.forEach( ( b, id ) => bats.push( `${ id }${ b.silenced ? ' silenced' : '' }${ b.platform ? ' (platform down)' : '' }${ b.powder ? ' (powder blown)' : '' }` ) );
					lines.push( `${ r.label.padEnd( 10 ) } ${ f.holder }${ f.holder === 'player' ? ' (' + ( f.byName || f.by ) + ')' : '' } alarm ${ f.alarm }, guards ${ f.guards < 0 ? '-' : f.guards }, ships down ${ f.shipsDown.toString( 2 ) }; ${ bats.join( ', ' ) || 'no batteries reported' }` );

				}

				return lines.length ? lines.join( '\n' ) : 'no stronghold running';

			}

			case 'captains': {

				if ( ! universe ) return 'no universe on this server';
				const list = universe.captainList().sort( ( a, b ) => b.lastSeen - a.lastSeen );
				return list.length ? list.map( ( c ) => `${ c.name.padEnd( 24 ) } last seen ${ c.lastSeen ? new Date( c.lastSeen ).toISOString().slice( 0, 16 ).replace( 'T', ' ' ) : '-' }  $${ Math.round( c.money ) }${ c.banned ? '  BANNED' : '' }` ).join( '\n' ) : 'no captains yet';

			}

			case 'kick': {

				const f = findClient( arg );
				if ( ! f ) return `nobody called "${ arg }" is online`;
				f.room.kick( f.m, 'kicked', 'The server admin disconnected you' );
				return `kicked ${ f.m.name }`;

			}

			case 'ban': {

				if ( ! universe ) return 'no universe on this server';
				if ( ! rest.length ) return 'usage: ban <name> [reason]';
				// the longest run of words that names a captain is the name, the rest the reason (an unknown name is reserved)
				let name = rest[ 0 ], reason = rest.slice( 1 ).join( ' ' );
				for ( let i = rest.length; i > 0; i -- ) {

					if ( universe.findCaptain( rest.slice( 0, i ).join( ' ' ) ) ) {

						name = rest.slice( 0, i ).join( ' ' );
						reason = rest.slice( i ).join( ' ' );
						break;

					}

				}

				const banned = universe.ban( name, reason );
				if ( ! banned ) return `no captain "${ name }"`;
				const u = uniRoom();
				if ( u ) for ( const m of [ ...u.order.values() ] ) if ( m.captainKey === captainKey( banned ) ) u.kick( m, 'banned', 'You are banned from this universe' );
				universe.flush();
				return `banned ${ banned }`;

			}

			case 'unban': {

				if ( ! universe ) return 'no universe on this server';
				const n = universe.unban( arg );
				if ( n ) universe.flush();
				return n ? `unbanned ${ n }` : `"${ arg }" is not banned`;

			}

			case 'release': {

				if ( ! universe ) return 'no universe on this server';
				const u = uniRoom();
				if ( u ) for ( const m of u.order.values() ) if ( m.captainKey === captainKey( arg ) ) return `${ m.name } is online: kick them first`;
				const n = universe.release( arg );
				if ( n ) universe.flush();
				return n ? `released ${ n }: the next browser to join as ${ n } owns the name and its game` : `no captain "${ arg }"`;

			}

			case 'save':
				if ( ! universe ) return 'no universe on this server';
				universe.flush( true );
				return `saved to ${ universe.dir }`;
			case 'backup':
				if ( ! universe ) return 'no universe on this server';
				universe.flush( true );
				return `backup in ${ universe.backup( true ) }`;
			case 'announce': {

				const text = cleanText( arg, 200 );
				if ( ! text ) return 'usage: announce <text>';
				const at = Date.now();
				for ( const r of ctx.rooms.values() ) r.broadcastExcept( 'chat', { id: '', name: 'Server', text, at, system: true } );
				if ( universe ) universe.pushChat( { name: 'Server', text, at, system: true } );
				return `announced to ${ everyone().length } player(s)`;

			}

			default:
				return `unknown command "${ cmd }" (type help)`;

		}

	};

	let closing = null;
	const close = () => closing || ( closing = ( async () => {

		ctx.closing = true;
		clearInterval( flushTimer );
		await srv.ready.catch( () => {} );
		try {

			// every room says goodbye (4001: the clients retry later); leaving captains moor their boats first
			await Promise.race( [ gs.gracefullyShutdown( false ), new Promise( ( r ) => setTimeout( r, 3000 ).unref() ) ] );

		} catch ( e ) {

			opts.log( `shutdown: ${ e && e.message || e }` );

		}

		ctx.rooms.clear();
		unregisterRoomDefinitions( Object.keys( rooms ) ); // (the matchmaker outlives this server in the process)
		if ( universe ) {

			try {

				universe.flush();

			} catch ( e ) {

				opts.log( `universe: final flush failed: ${ e.message }` );

			}

		}

		await new Promise( ( resolve ) => {

			if ( ! server.listening ) return resolve();
			server.close( () => resolve() );
			if ( server.closeAllConnections ) server.closeAllConnections();
			setTimeout( resolve, 1500 ).unref();

		} );
		if ( active === srv ) active = null;

	} )() );

	srv.ready = ( async () => {

		await new Promise( ( resolve, reject ) => {

			server.once( 'error', reject );
			gs.listen( opts.port, opts.host ).then( resolve, reject );

		} );
		if ( universe ) await matchMaker.createRoom( 'universe', {} );
		return server.address().port;

	} )();
	srv.ready.catch( () => { if ( active === srv ) active = null; clearInterval( flushTimer ); } );
	srv.close = close;
	srv.admin = admin;
	return srv;

}

// ---- the console and shutdown (the CLI below and tools/host/serve-universe.mjs)

// admin commands typed into the server window; `stop` (or Ctrl-C) saves and exits
// (a container or a service has no terminal: stdin is /dev/null or a pipe, and the console stays off unless `force`)
export function attachConsole( srv, { input = process.stdin, output = process.stdout, onStop = null, force = false } = {} ) {

	if ( ! input || ! input.readable ) return null;
	if ( input === process.stdin && ! input.isTTY && ! force ) return null;
	const rl = readline.createInterface( { input, output, terminal: !! input.isTTY, prompt: '> ' } );
	rl.on( 'line', ( line ) => {

		const cmd = line.trim().toLowerCase();
		if ( cmd === 'stop' || cmd === 'quit' || cmd === 'exit' ) {

			rl.close();
			if ( onStop ) onStop( 'stop' );
			return;

		}

		const answer = srv.admin( line );
		if ( answer ) output.write( answer + '\n' );
		rl.prompt();

	} );
	// a terminal's Ctrl-C reaches readline, not the process
	rl.on( 'SIGINT', () => { if ( onStop ) onStop( 'SIGINT' ); } );
	return rl;

}

// Ctrl-C, a service stop or the console window closing: the universe is written before the process ends
export function stopOnSignals( srv, log = console.log ) {

	let stopping = false;
	const stop = ( sig ) => {

		if ( stopping ) return;
		stopping = true;
		log( `\n${ sig }: saving and closing` );
		srv.close().then( () => process.exit( 0 ) );
		// the rooms get 3 s to say goodbye, then the universe is written; this is the last resort (fly.toml: kill_timeout 30 s)
		setTimeout( () => process.exit( 0 ), 8000 ).unref();

	};

	for ( const sig of [ 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK' ] ) {

		try { process.on( sig, () => stop( sig ) ); } catch ( e ) { /* not on this platform */ }

	}

	// the last word: a synchronous flush however the process ends
	process.on( 'exit', () => { try { if ( srv.universe ) srv.universe.flush(); } catch ( e ) { /* nothing more to do */ } } );
	return stop;

}

// ---- CLI

function parseArgs( argv ) {

	const o = { port: Number( process.env.PORT ) || 8765, host: process.env.HOST || '0.0.0.0', roomCap: MAX_PLAYERS, console: true, forceConsole: false, adminToken: process.env.ADMIN_TOKEN || null };
	for ( let i = 0; i < argv.length; i ++ ) {

		const a = argv[ i ], v = argv[ i + 1 ];
		if ( a === '--port' ) o.port = Number( v ), i ++;
		else if ( a === '--host' ) o.host = v, i ++;
		else if ( a === '--room-cap' ) o.roomCap = Math.max( 1, Number( v ) | 0 ), i ++;
		else if ( a === '--max-rooms' ) o.maxRooms = Math.max( 1, Number( v ) | 0 ), i ++;
		else if ( a === '--universe' ) o.universe = v, i ++;
		else if ( a === '--data' ) o.data = v, i ++;
		else if ( a === '--max-players' ) o.universeCap = Math.max( 1, Math.min( 64, Number( v ) | 0 ) ), i ++;
		else if ( a === '--backup-days' ) o.backupDays = Math.max( 1, Number( v ) | 0 ), i ++;
		else if ( a === '--reconnect-seconds' ) o.reconnectSeconds = Math.max( 0, Math.min( 600, Number( v ) | 0 ) ), i ++;
		else if ( a === '--no-console' ) o.console = false;
		else if ( a === '--console' ) o.forceConsole = true; // (read stdin even when it is not a terminal)
		else if ( a === '--admin-token' ) o.adminToken = v || null, i ++;
		else if ( a === '--help' || a === '-h' ) {

			console.log( 'usage: node server/index.mjs [--port 8765] [--host 0.0.0.0] [--room-cap 16] [--max-rooms 64]\n' +
				'                            [--universe <name> [--data <dir>] [--max-players 16] [--backup-days 14]] [--reconnect-seconds 60]\n' +
				'                            [--no-console | --console] [--admin-token <token> (or ADMIN_TOKEN)]   env: PORT, HOST, BUILD_HASH' );
			process.exit( 0 );

		}

	}

	return o;

}

const isMain = process.argv[ 1 ] && pathToFileURL( process.argv[ 1 ] ).href === import.meta.url;
if ( isMain ) {

	const o = parseArgs( process.argv.slice( 2 ) );
	const srv = startServer( o );
	const stop = stopOnSignals( srv );
	srv.ready.then( ( port ) => {

		console.log( `Hyptile Island server (Colyseus) listening on ws://${ o.host }:${ port }/<room> (default room 'island', cap ${ o.roomCap }); health: http://${ o.host }:${ port }/health` );
		if ( srv.universe ) console.log( `Universe '${ srv.universe.name }' at ws://${ o.host }:${ port }/${ UNIVERSE_PATH } (data: ${ srv.universe.dir }); type help for admin commands` );
		if ( o.adminToken ) console.log( 'Admin HTTP routes on: /admin/stats, /admin/save, /admin/backup, /admin/command (Authorization: Bearer <token>)' );
		if ( o.console && ! attachConsole( srv, { onStop: stop, force: o.forceConsole } ) ) console.log( 'No terminal: the admin console is off (SIGTERM / Ctrl-C saves and stops)' );

	}, ( e ) => {

		console.error( 'listen failed:', e.message );
		process.exit( 1 );

	} );

}
