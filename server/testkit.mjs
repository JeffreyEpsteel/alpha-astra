// A plain-node test client for the Hyptile Island server (test/net-protocol.mjs, test/universe.mjs, test/colyseus.mjs):
// one src/net/ColyseusLink with a queue of the messages it produced, so a test can wait for one by tag.
//
//   const c = wireClient( 'ws://127.0.0.1:8765/island' );
//   c.send( { t: 'hello', v: 2, name, character, boat, token? } )   the first hello joins (a refusal queues { t: 'error', code }
//                                                                   and resolves c.closedP with { code: REFUSAL number })
//   await c.next( 'welcome' ) / c.next( ( m ) => ... , ms )         the next queued (or arriving) message that matches
//   c.send( { t: 'state', ... } ) / c.send( 'text' ) (a junk frame) / c.sendRaw( type, payload )
//   c.drain( pred ) -> [ messages ]   c.close() (a goodbye)   c.drop( reconnect? ) (a lost network: the server keeps the seat;
//   the SDK retries only with reconnect = true)

import { ColyseusLink } from '../src/net/ColyseusLink.js';
import { REFUSAL } from '../src/net/Protocol.js';

export function wireClient( url ) {

	const queue = [];
	const waiters = [];
	let closed = null, resolveClosed = null;
	const closedP = new Promise( ( r ) => { resolveClosed = r; } );
	const finish = ( info ) => {

		if ( closed ) return;
		closed = info;
		resolveClosed( info );

	};

	const push = ( m ) => {

		const i = waiters.findIndex( ( w ) => w.pred( m ) );
		if ( i >= 0 ) waiters.splice( i, 1 )[ 0 ].resolve( m );
		else queue.push( m );

	};

	const link = new ColyseusLink( { url, onMessage: push, onClose: ( { code } ) => finish( { code } ) } );
	let joined = null;
	const next = ( pred, ms = 3000 ) => {

		if ( typeof pred === 'string' ) { const t = pred; pred = ( m ) => m.t === t; }
		const i = queue.findIndex( pred );
		if ( i >= 0 ) return Promise.resolve( queue.splice( i, 1 )[ 0 ] );
		return new Promise( ( resolve, reject ) => {

			const w = { pred, resolve };
			waiters.push( w );
			setTimeout( () => {

				const j = waiters.indexOf( w );
				if ( j >= 0 ) { waiters.splice( j, 1 ); reject( new Error( 'timeout waiting for a message' ) ); }

			}, ms );

		} );

	};

	const sendNow = ( m ) => ( typeof m === 'string' ? link.sendRaw( 'junk', m ) : link.send( m ) );
	const send = ( m ) => {

		if ( m && m.t === 'hello' && ! joined ) {

			const { t, ...hello } = m;
			joined = link.join( hello ).catch( ( e ) => {

				push( { t: 'error', code: e.code, text: e.text || e.message } );
				finish( { code: REFUSAL[ e.code ] || 0, refused: e.code } );

			} );
			return true;

		}

		// sends made right after the hello go out once the room is joined
		if ( joined && ! link.room ) return void joined.then( () => sendNow( m ) );
		return sendNow( m );

	};

	const drain = ( pred ) => {

		const out = queue.filter( pred );
		for ( const m of out ) queue.splice( queue.indexOf( m ), 1 );
		return out;

	};

	const close = () => {

		link.leave();
		finish( { code: 4000 } );

	};

	return {
		link, queue, next, send, drain, closedP, close,
		sendRaw: ( type, payload ) => link.sendRaw( type, payload ),
		drop: ( reconnect = false ) => link.drop( reconnect ), // (a lost network that does not come back, unless reconnect)
		open: Promise.resolve(),
		ws: { close }, // (the 2.x tests closed the socket: now a goodbye)
		get joined() { return joined; },
		get closed() { return closed; },
		get id() { return link.id; },
	};

}
