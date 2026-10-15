// The towns' destructible props and the host-only world events (wave 13: Tidemark and its "Hold the line" raid).
//
//   props    a break is the destruction feature's own world event (propDestroyed { id, kind, x, y, z, by, port, site, respawn }:
//            the port is there for the quests); the server gives prop events their own budget so a blast loses none. The
//            respawn: the host's destruction respawns a prop on its clock (propRespawned, not forced) and this link sends
//            them batched ('propsRespawned' { port, ids }, every TOWN_SYNC.flush s); everybody else gets one remote
//            propRespawned { id, port } per prop (NetSync._onEvent expands the batch), so a guest's town comes back with the
//            host's. In a universe the server's own expiry carries the port too (Protocol WORLD_EVENT_RULES carry).
//   host     sync.hostOnly() -> true offline or on the room's host: the caller may run something that changes the shared
//            world (naval.spawn of a raider: a guest's naval is a puppet and spawns nothing).
//            sync.askHost( kind, data ) -> bool   run it on the host: offline / on the host the request is emitted here at
//            once, a guest's goes to the host alone; the host's features hear features.on( 'hostRequest', ( { kind, data,
//            from, local } ) => ... ) and run it there (its ships reach everybody through NavalLink).
//
//   const tl = new TownLink( sync );  tl.bind( net );  tl.update( dt );  tl.expand( event ) -> [ events ];  tl.stats

export const TOWN_SYNC = {
	flush: 0.5, // s a host's respawns wait to go out together
	batch: 40, // ids per event (MAX_EVENT_DATA)
};

export class TownLink {

	constructor( sync ) {

		this.sync = sync;
		this.queue = [];
		this.stats = { respawnsOut: 0, batchesOut: 0, respawnsIn: 0, asksOut: 0, asksIn: 0 };
		this._acc = 0;
		this._offs = [];
		const f = sync.features;
		this._fOff = f && f.on ? f.on( 'propRespawned', ( e ) => this._onRespawn( e ) ) : null;

	}

	get features() {

		return this.sync.features;

	}

	bind( net ) {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.queue.length = 0;
		this._acc = 0;
		if ( ! net ) return;
		this._offs.push( net.on( 'ask', ( m ) => this._onAsk( m ) ) );

	}

	// ------------------------------------------------------------------ props

	_onRespawn( e ) {

		const net = this.sync.net;
		if ( ! e || typeof e.id !== 'string' || e.forced || ! net || ! net.online || ! net.isHost ) return;
		const f = this.features, d = f && f.get ? f.get( 'destruction' ) : null;
		const prop = d && d.byId && d.byId.get ? d.byId.get( e.id ) : null;
		this.queue.push( { id: e.id, port: prop && typeof prop.port === 'string' ? prop.port : typeof e.port === 'string' ? e.port : null } );

	}

	_flush() {

		const net = this.sync.net;
		const q = this.queue.splice( 0 );
		if ( ! net || ! net.online || ! net.isHost ) return;
		const byPort = new Map();
		for ( const e of q ) {

			const k = e.port || '';
			if ( ! byPort.has( k ) ) byPort.set( k, [] );
			if ( ! byPort.get( k ).includes( e.id ) ) byPort.get( k ).push( e.id );

		}

		for ( const [ port, ids ] of byPort ) for ( let i = 0; i < ids.length; i += TOWN_SYNC.batch ) {

			const part = ids.slice( i, i + TOWN_SYNC.batch );
			if ( net.sendEvent( 'propsRespawned', { port: port || null, ids: part } ) ) {

				this.stats.batchesOut ++;
				this.stats.respawnsOut += part.length;

			}

		}

	}

	// a host's batch as the single events every feature knows
	expand( m ) {

		const d = m && m.data;
		if ( ! d || ! Array.isArray( d.ids ) ) return [];
		const port = typeof d.port === 'string' ? d.port : null;
		const out = [];
		for ( const id of d.ids ) if ( typeof id === 'string' ) out.push( { ...m, kind: 'propRespawned', data: { id, port } } );
		this.stats.respawnsIn += out.length;
		return out;

	}

	// ------------------------------------------------------------------ the host's world

	hostOnly() {

		const net = this.sync.net;
		return ! net || ! net.online || net.isHost;

	}

	askHost( kind, data = {} ) {

		const net = this.sync.net;
		if ( typeof kind !== 'string' || ! /^[A-Za-z][\w.:-]{0,31}$/.test( kind ) ) return false;
		if ( this.hostOnly() ) {

			this._emit( { kind, data, from: net && net.id ? net.id : 'self', local: true } );
			return true;

		}

		if ( ! net.sendMsg( { t: 'ask', kind, data } ) ) return false;
		this.stats.asksOut ++;
		return true;

	}

	_onAsk( m ) {

		const net = this.sync.net;
		if ( ! m || ! net || ! net.isHost || typeof m.kind !== 'string' ) return;
		this.stats.asksIn ++;
		this._emit( { kind: m.kind, data: m.data && typeof m.data === 'object' ? m.data : {}, from: m.from || '?', local: false } );

	}

	_emit( e ) {

		if ( this.sync._emit ) this.sync._emit( 'hostRequest', e );

	}

	update( dt ) {

		if ( ! this.queue.length ) return;
		this._acc += dt;
		if ( this._acc < TOWN_SYNC.flush ) return;
		this._acc = 0;
		this._flush();

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		if ( this._fOff ) this._fOff();
		this._fOff = null;
		this.queue.length = 0;

	}

}
