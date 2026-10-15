// The navy's law for everybody in the room (wave 20E, the wave 19B navy in multiplayer). The host runs the navy's ships
// (NavalLink); this link carries what each player's navy needs to judge and to be judged:
//
//   wanted   every player's state carries nw: [ wanted 0|1, hostile 0|1, the last hail seen ] while any of it is set (absent:
//            an honest boat, no bytes). Every client fills navy.remote ( peer id -> { wanted, hostile, at } ) from the
//            others' states each frame, so the host's navy judges each boat by its own player's slate the moment he joins,
//            after a host migration and after a reconnect. The navy's own 'navyWanted' world events are not sent any more
//            (sync.sendWorldEvent swallows them: the state says it).
//   hails    the host's navy hails a remote boat with world event 'navyHail' { to, say, ship } (Navy._outbox). This link
//            numbers it (n), the server hands it to that player alone. The host keeps each player's hails in order and sends
//            the next only once his state acknowledged the one before (nw[ 2 ] === n), resending the unacknowledged one every
//            NAVY_SYNC.resend s until NAVY_SYNC.ttl s pass: a dropped socket (the SDK reconnects to the same id) loses no
//            boarding, and a later 'hail' never buries an unheard 'board'. The receiver drops a number it has seen, so a
//            resent 'board' fines once.
//
//   const nl = new NavyLink( sync );  nl.decorate( state );  nl.update( dt );  nl.sendHail( data ) -> bool
//   nl.accept( event ) -> bool (false: not for us / seen already: NetSync does not emit it)   nl.pending (Map to -> [ hail ])
//   nl.stats { hailsOut, resent, acked, hailsIn, dupes }

export const NAVY_SYNC = {
	resend: 2, // s between resends of an unacknowledged hail
	ttl: 25, // s a hail is worth resending (the boarding party does not wait longer)
	ackKeep: 30, // s a receiver keeps acknowledging its last hail in its state
	seen: 32, // hail numbers a receiver remembers
	queue: 4, // hails waiting per player (the oldest go first)
};

const num = ( v ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : 0 );

export class NavyLink {

	constructor( sync ) {

		this.sync = sync;
		this.pending = new Map(); // host side: peer id -> [ { data, at, sent } ] in order (the first is out, unacknowledged)
		this.stats = { hailsOut: 0, resent: 0, acked: 0, hailsIn: 0, dupes: 0 };
		this._n = 1 + Math.floor( Math.random() * 1e6 ); // (a new host does not reuse an old host's numbers)
		this._seen = [];
		this._ack = 0;
		this._ackT = 0;
		this.time = 0;

	}

	get navy() {

		const f = this.sync.features;
		return f && f.get ? f.get( 'navy' ) : null;

	}

	clear() {

		this.pending.clear();

	}

	// ------------------------------------------------------------------ state

	// our slate: [ wanted, hostile, last hail seen ] (only while something is set)
	decorate( s ) {

		const nv = this.navy;
		if ( ! s || ! nv ) return s;
		const wanted = !! nv._wanted;
		const hostile = Number.isFinite( nv.time ) && Number.isFinite( nv.hostileUntil ) && nv.time < nv.hostileUntil;
		const ack = this._ackT > this.time ? this._ack : 0;
		if ( wanted || hostile || ack ) s.nw = ack ? [ wanted ? 1 : 0, hostile ? 1 : 0, ack ] : [ wanted ? 1 : 0, hostile ? 1 : 0 ];
		return s;

	}

	// every peer's slate into the navy's book (the host's navy reads it; a guest keeps it for a host migration)
	_judge() {

		const nv = this.navy, rp = this.sync.app.remotePlayers;
		if ( ! nv || ! nv.remote || typeof nv.remote.set !== 'function' ) return;
		const t = num( nv.time );
		if ( rp && rp.peers ) {

			for ( const [ id, p ] of rp.peers ) {

				const w = p.extra && Array.isArray( p.extra.nw ) ? p.extra.nw : null;
				const e = nv.remote.get( id );
				const wanted = !! ( w && w[ 0 ] ), hostile = !! ( w && w[ 1 ] );
				if ( e && e.wanted === wanted && e.hostile === hostile ) e.at = t;
				else nv.remote.set( id, { wanted, hostile, at: t } );

			}

		}

		for ( const id of [ ...nv.remote.keys() ] ) if ( ! rp || ! rp.peers || ! rp.peers.has( id ) ) nv.remote.delete( id );

	}

	// ------------------------------------------------------------------ hails

	// the host's navy hails a remote boat: numbered, sent to that player, kept until acknowledged
	sendHail( data ) {

		const net = this.sync.net;
		if ( ! net || ! net.online || ! data || typeof data.to !== 'string' ) return false;
		const d = { to: data.to, say: String( data.say || '' ).slice( 0, 12 ), ship: String( data.ship || '' ).slice( 0, 40 ), n: this._n ++ };
		let q = this.pending.get( d.to );
		if ( ! q ) this.pending.set( d.to, q = [] );
		if ( q.length >= NAVY_SYNC.queue ) q.splice( 1, 1 ); // (the first is on its way; the stalest waiting one makes room)
		q.push( { data: d, at: this.time, sent: q.length ? - Infinity : this.time } );
		this.stats.hailsOut ++;
		return q.length === 1 ? net.sendEvent( 'navyHail', d ) : true;

	}

	// a hail arrived: ours and new -> true (NetSync emits it); acknowledged in our state either way
	accept( m ) {

		const net = this.sync.net, d = m && m.data;
		if ( ! d || ! net || d.to !== net.id ) return false;
		const n = num( d.n );
		if ( n ) {

			this._ack = n;
			this._ackT = this.time + NAVY_SYNC.ackKeep;
			const key = `${ m.from || '' }:${ n }`;
			if ( this._seen.includes( key ) ) {

				this.stats.dupes ++;
				return false;

			}

			this._seen.push( key );
			if ( this._seen.length > NAVY_SYNC.seen ) this._seen.shift();

		}

		this.stats.hailsIn ++;
		return true;

	}

	_resend() {

		const net = this.sync.net, rp = this.sync.app.remotePlayers;
		if ( ! this.pending.size ) return;
		if ( ! net || ! net.online || ! net.isHost ) {

			this.pending.clear(); // (the hails were the old host's business)
			return;

		}

		for ( const [ to, q ] of this.pending ) {

			// (a peer gone for good leaves net.peers; a dropped one keeps its seat and id)
			if ( ! net.peers.has( to ) ) {

				this.pending.delete( to );
				continue;

			}

			const p = rp && rp.peers ? rp.peers.get( to ) : null;
			const w = p && p.extra && Array.isArray( p.extra.nw ) ? p.extra.nw : null;
			if ( q.length && w && w[ 2 ] === q[ 0 ].data.n ) {

				q.shift();
				this.stats.acked ++;

			}

			while ( q.length && this.time - q[ 0 ].at > NAVY_SYNC.ttl ) q.shift();
			if ( ! q.length ) {

				this.pending.delete( to );
				continue;

			}

			const h = q[ 0 ];
			if ( this.time - h.sent < NAVY_SYNC.resend ) continue;
			if ( h.sent !== - Infinity ) this.stats.resent ++;
			h.sent = this.time;
			net.sendEvent( 'navyHail', h.data );

		}

	}

	update( dt ) {

		this.time += dt > 0 ? dt : 0;
		const net = this.sync.net;
		if ( ! net || ! net.online ) return;
		this._judge();
		this._resend();

	}

}
