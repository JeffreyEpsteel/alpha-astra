// The Blackwater stronghold for everybody in the room (wave 13), host-authoritative. The room's host runs the stronghold
// (src/features/pirates/Stronghold.js) for the whole room and streams its state into the room schema's `fort`
// (server/schema.mjs Fort): the holder and the claim (who, claimed at, retaken at: game hours on the host's clock), the
// watch's alarm, each battery's silenced state with its gun platform and powder store, the guards still on watch, the
// moored ships sunk / crippled and cast off. Everybody else mirrors it.
//
//   host    its batteries fire at the nearest hostile player boat, its own or a guest's (the guests' boats come from
//           RemotePlayers; `bw: 1` in a guest's state near Blackwater says the brotherhood lets her in); the balls reach the
//           guests through NavalLink like any ship's. The moored ships cast off / are spawned for the player nearest the cove,
//           nothing is rebuilt under any player's nose, the restock timer (the brotherhood retaking a claimed island) runs
//           here. A guest's hostile act ('fortAct': the bell, a hostile in sight, a guard beaten) reaches its watch.
//   guest   no battery fires here, the watch never rings on its own (a hostile in sight / an attack is reported to the host),
//           nothing is rebuilt or retaken locally; the host's snapshot is applied (the bell, silenced batteries, broken
//           platforms and powder stores, the guards left, the ships). Guards are fought locally (like the dens' raiders):
//           a guard beaten here is reported and the host takes one off its watch, so the count is the room's.
//   claim   anybody's E at the flagstaff asks the server ({ t: 'fort', op: 'claim' }); the server grants it once (the host's
//           snapshot must say the island is undefended) and answers 'fortClaim': the claimant alone takes the loot, everybody
//           else sees the island change hands (a remote claim). When the brotherhood retakes it only the claimant's
//           Stronghold sends the retaliation.
//   props   a fort structure owned by the destruction feature and broken on another machine (its propDestroyed world event)
//           breaks here too, so its battery is silenced everywhere.
// All of it survives a reconnect (the schema is reconciled; a returning guest re-applies everything) and a host change (the
// new host's stronghold already mirrors the room's).
//
// Instance-level overrides on the Stronghold (removed again offline / in solo), so pirates/** needs no network code:
//   both     s.claim( { remote } ) through the server; s._retake gated
//   host     s.alarm.update (remote hostility counts), s._target (remote boats), s._shipsUpdate / s._rebuild / s._guardsUpdate
//            (the nearest player)
//   guest    s.batteries.update (none), s.alarm.update / spot / raise (reported), s._rebuild / s._shipsUpdate (none: the
//            host's ships are NavalLink puppets here), s.defeatGuard (reported),
//            s._guardCount (the host's watch)
//
//   const fl = new StrongholdLink( sync );  fl.bind( net );  fl.update( dt );  fl.decorate( state );  fl.role;  fl.stats

export const FORT_SYNC = {
	every: 0.25, // s between two looks at the host's stronghold
	heartbeat: 3, // s: an unchanged snapshot goes again this often
	hostileEvery: 0.8, // s between two 'hostile' reports of a guest
	hostileHold: 2.5, // s a guest's report keeps the host's watch hostile
	near: 1500, // m from Blackwater: the state carries bw (let in or not)
	claimWait: 4, // s before another claim may be asked for
};

const CLAIM_TEXT = {
	taken: 'Another crew claimed Blackwater first',
	defended: 'Blackwater is not undefended yet',
	rate: null,
};

function patch( list, obj, name, fn ) {

	if ( ! obj ) return;
	list.push( { obj, name, own: Object.prototype.hasOwnProperty.call( obj, name ), prev: obj[ name ] } );
	obj[ name ] = fn;

}

export class StrongholdLink {

	constructor( sync ) {

		this.sync = sync;
		this.role = 'solo';
		this.stats = { sets: 0, applied: 0, actsOut: 0, actsIn: 0, claims: 0, granted: 0, refused: 0, guardsIn: 0 };
		this.time = 0;
		this._s = null;
		this._patches = [];
		this._orig = {};
		this._offs = [];
		this._reset();
		const f = sync.features;
		this._fOff = f && f.on ? f.on( 'remoteWorldEvent', ( e ) => this._onRemoteEvent( e ) ) : null;

	}

	_reset() {

		this._acc = 0;
		this._sig = '';
		this._sentAt = - 1e9;
		this._hostile = 0;
		this._hostileSent = - 1e9;
		this._seenClaims = - 1;
		this._granted = - 1;
		this._claimAt = - 1e9;
		this._mineClaim = false;
		this._adoptOwn = false;
		this._allowRetake = false;
		this._lastSeq = - 1;
		this._lastGuards = null;

	}

	get features() {

		return this.sync.features;

	}

	get s() {

		const f = this.features;
		return f && f.get ? f.get( 'stronghold' ) : null;

	}

	get net() {

		return this.sync.net;

	}

	_fort() {

		const net = this.net, room = net && net.link ? net.link.room : null;
		return room && room.state && room.state.fort ? room.state.fort : null;

	}

	// the server keeps the stronghold in its state (an older server does not: the world events are all there is)
	get supported() {

		return !! this._fort();

	}

	bind( net ) {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this._setRole( 'solo' );
		this._reset();
		if ( ! net ) return;
		this._offs.push( net.on( 'fortClaim', ( m ) => this._onClaim( m ) ) );
		this._offs.push( net.on( 'fortAct', ( m ) => this._onAct( m ) ) );

	}

	// ------------------------------------------------------------------ roles

	_unpatch() {

		for ( const p of this._patches.reverse() ) {

			if ( p.own ) p.obj[ p.name ] = p.prev;
			else delete p.obj[ p.name ];

		}

		this._patches.length = 0;
		this._orig = {};

	}

	_setRole( role ) {

		this._unpatch();
		this.role = role;
		this._sig = '';
		this._lastSeq = - 1;
		this._lastGuards = null;
		const s = this.s;
		if ( ! s || role === 'solo' ) return;
		const P = this._patches, o = this._orig = {}, al = s.alarm;
		// every online role: the claim through the server, the retake when the room says so
		o.claim = s.claim;
		patch( P, s, 'claim', ( opts = {} ) => ( opts && opts.remote ? o.claim.call( s, opts ) : this._requestClaim() ) );
		o.retake = s._retake;
		patch( P, s, '_retake', () => ( this.role === 'host' || this._allowRetake ? this._retake() : undefined ) );
		if ( role === 'host' ) {

			o.alarmUpdate = al.update;
			patch( P, al, 'update', ( dt, hostile ) => {

				const rh = this._hostile > 0 && s.holder === 'pirates';
				if ( rh && al.state === 'calm' ) al.spot( 'sighted' );
				return o.alarmUpdate.call( al, dt, hostile || rh );

			} );
			o.target = s._target;
			patch( P, s, '_target', () => this._hostTarget() );
			o.ships = s._shipsUpdate;
			patch( P, s, '_shipsUpdate', ( pl ) => o.ships.call( s, this._nearest( s.L.cove, pl ) ) );
			o.rebuild = s._rebuild;
			patch( P, s, '_rebuild', ( pl ) => o.rebuild.call( s, this._nearest( s.L.center, pl ) ) );
			// the watch turns out for whoever comes near (with the bell, or the host ashore)
			o.guards = s._guardsUpdate;
			patch( P, s, '_guardsUpdate', ( dt, pl ) => o.guards.call( s, dt, this._nearest( s.L.fort, pl ) ) );
			const fort = this._fort(), net = this.net;
			if ( fort && net && s.holder === 'player' && fort.holder === 'pirates' ) {

				// a host whose own game holds the island: the room's claim, if nobody ran it before (else it is the pirates')
				this._adoptOwn = true;
				net.sendMsg( { t: 'fort', op: 'claim' } );

			}

		} else {

			patch( P, s.batteries, 'update', () => [] );
			patch( P, al, 'update', ( dt, hostile ) => {

				if ( hostile ) this._reportHostile();
				return null;

			} );
			patch( P, al, 'spot', () => {

				this._reportHostile();
				return false;

			} );
			patch( P, al, 'raise', ( why ) => {

				this._act( 'raise', why );
				return false;

			} );
			patch( P, s, '_rebuild', () => {} );
			// the moored ships are the host's (NavalLink shows them here as puppets): none spawned here
			for ( const sl of s.ships ) sl.ship = null;
			patch( P, s, '_shipsUpdate', () => {} );
			// the watch is the host's: its count (plus the ones beaten here) is what turns out here
			o.guardCount = s._guardCount;
			patch( P, s, '_guardCount', () => {

				const f = this._fort();
				return f && f.seq && f.guards >= 0 ? f.guards + ( s._beaten || 0 ) : o.guardCount.call( s );

			} );
			o.defeat = s.defeatGuard;
			patch( P, s, 'defeatGuard', ( r ) => {

				const ok = o.defeat.call( s, r );
				if ( ok ) this._act( 'guard' );
				return ok;

			} );

		}

	}

	// ------------------------------------------------------------------ the claim

	_requestClaim() {

		const s = this.s, net = this.net;
		if ( ! s || s.holder !== 'pirates' || ! s.claimable().ok ) return null;
		if ( ! net || ! net.online ) return null;
		if ( this.time - this._claimAt < FORT_SYNC.claimWait ) return { pending: true };
		this._claimAt = this.time;
		if ( this.role === 'host' ) this._send( true ); // (the server must have heard it is undefended)
		net.sendMsg( { t: 'fort', op: 'claim' } );
		this.stats.claims ++;
		return { pending: true };

	}

	_onClaim( m ) {

		const s = this.s;
		this._claimAt = - 1e9;
		if ( ! m || ! s ) return;
		if ( m.ok ) {

			if ( Number.isFinite( m.claims ) ) this._seenClaims = m.claims;
			this._grant( Number.isFinite( m.claims ) ? m.claims : this._granted + 1 );
			this._adoptOwn = false;
			this._acc = FORT_SYNC.every; // (the host tells the room at once)
			return;

		}

		this.stats.refused ++;
		if ( this._adoptOwn ) {

			// the room's island is the pirates': this host's old claim gives way
			this._adoptOwn = false;
			this._allowRetake = true;
			try { this._retake( true ); } finally { this._allowRetake = false; }
			return;

		}

		const text = CLAIM_TEXT[ m.reason ];
		if ( text ) s.toast( text, 2600 );

	}

	// the server granted this player the claim: the loot, once per claim
	_grant( n ) {

		const s = this.s, o = this._orig;
		if ( this._granted === n || ! s || ! o.claim ) return;
		this._granted = n;
		this._mineClaim = true;
		this.stats.granted ++;
		if ( s.holder !== 'pirates' ) return;
		const r = o.claim.call( s, {} );
		if ( ! r ) o.claim.call( s, { remote: true } ); // (the local view changed meanwhile: the room's claim still stands)

	}

	// a claim the server granted since this client last looked: whose it is decides what happens here
	_syncClaim( fort ) {

		if ( fort.claims === this._seenClaims ) return;
		this._seenClaims = fort.claims;
		const s = this.s, net = this.net;
		if ( fort.holder !== 'player' || ! s ) return;
		if ( fort.by && net && fort.by === net.id ) return this._grant( fort.claims );
		if ( s.holder === 'pirates' && this._orig.claim ) this._orig.claim.call( s, { remote: true } );

	}

	// the brotherhood takes the island back: only the claimant's game sends the retaliation raid
	_retake( quiet = ! this._mineClaim ) {

		const s = this.s, o = this._orig;
		if ( ! s || ! o.retake ) return;
		this._mineClaim = false;
		const p = s.pirates, r = p && p.retaliation;
		if ( ! quiet || ! r || typeof r.trigger !== 'function' ) return o.retake.call( s );
		const had = Object.prototype.hasOwnProperty.call( r, 'trigger' ), t = r.trigger;
		r.trigger = () => null;
		try {

			return o.retake.call( s );

		} finally {

			if ( had ) r.trigger = t;
			else delete r.trigger;

		}

	}

	// ------------------------------------------------------------------ host

	_snapshot() {

		const s = this.s, R = s.R;
		const bits = ( f ) => s.ships.reduce( ( m, sl, i ) => ( f( sl ) ? m | ( 1 << i ) : m ), 0 );
		const broken = ( id ) => {

			const st = id && s.structs.get( id );
			return !! ( st && st.broken );

		};

		const claimedAt = s.holder === 'player' && Number.isFinite( s.claimedAt ) ? Math.round( s.claimedAt * 100 ) / 100 : - 1;
		let open = false;
		try { open = !! s.claimable().ok; } catch ( e ) { /* no verdict */ }
		return {
			op: 'set', holder: s.holder, claimedAt, until: claimedAt >= 0 ? Math.round( ( claimedAt + R.restock ) * 100 ) / 100 : - 1,
			alarm: s.alarm.state, why: typeof s.alarm.why === 'string' ? s.alarm.why : '',
			guards: Number.isFinite( s.guardsLeft ) ? s.guardsLeft : - 1,
			shipsDown: bits( ( sl ) => sl.down ), castOff: bits( ( sl ) => !! ( sl.ship && sl.ship.state && sl.ship.state !== 'moored' && sl.ship.state !== 'gone' ) ),
			open, seen: Math.max( 0, this._seenClaims ),
			batteries: s.batteries.list.map( ( b ) => ( { id: b.id, silenced: !! b.silenced, why: b.why || '', platform: broken( b.platform ), powder: broken( b.powder ) } ) ),
		};

	}

	_send( force = false ) {

		const net = this.net;
		if ( ! net || ! net.online || this.role !== 'host' || ! this.s ) return false;
		const snap = this._snapshot(), sig = JSON.stringify( snap );
		if ( ! force && sig === this._sig && this.time - this._sentAt < FORT_SYNC.heartbeat ) return false;
		if ( ! net.sendMsg( { t: 'fort', ...snap } ) ) return false;
		this._sig = sig;
		this._sentAt = this.time;
		this.stats.sets ++;
		return true;

	}

	_hostTick( dt, fort ) {

		this._hostile = Math.max( 0, this._hostile - dt );
		this._syncClaim( fort );
		this._acc += dt;
		if ( this._acc < FORT_SYNC.every ) return;
		this._acc = 0;
		this._send( false );

	}

	// a guest's hostile act for this host's watch
	_onAct( m ) {

		const s = this.s;
		if ( this.role !== 'host' || ! s || ! m ) return;
		this.stats.actsIn ++;
		if ( s.holder !== 'pirates' ) return;
		const why = typeof m.why === 'string' && m.why ? m.why : 'attack';
		if ( m.act === 'hostile' ) this._hostile = FORT_SYNC.hostileHold;
		else if ( m.act === 'raise' ) {

			this._hostile = FORT_SYNC.hostileHold;
			if ( s.alarm.raise( why ) ) s._bell( why );

		} else if ( m.act === 'guard' ) this._guardDown();
		this._acc = FORT_SYNC.every;

	}

	// a guard beaten on a guest's machine: one fewer on this watch (no reward here: the guest had it)
	_guardDown() {

		const s = this.s;
		this.stats.guardsIn ++;
		if ( s.guardsLeft === null || s.guardsLeft === undefined ) s.guardsLeft = s._guardCount();
		if ( s.guardsLeft <= 0 ) return;
		s.guardsLeft --;
		s._beaten = ( s._beaten || 0 ) + 1;
		const act = s.guards.filter( ( r ) => r && r.active );
		const r = act[ act.length - 1 ];
		if ( r ) {

			r.beatenOut = true;
			if ( r.deactivate ) r.deactivate();

		}

	}

	// the other players: { x, z, boat: { x, z, vx, vz } | null, friendly, id }
	_others() {

		const out = [], rp = this.sync.app.remotePlayers;
		if ( ! rp || ! rp.peers ) return out;
		for ( const [ id, p ] of rp.peers ) {

			if ( ! p.hasPose ) continue;
			const hv = p.extra && Array.isArray( p.extra.hv ) ? p.extra.hv : null;
			const boat = p.boatState && p.boatPos ? { x: p.boatPos.x, z: p.boatPos.z, vx: hv && Number.isFinite( hv[ 0 ] ) ? hv[ 0 ] : 0, vz: hv && Number.isFinite( hv[ 1 ] ) ? hv[ 1 ] : 0 } : null;
			const aboard = boat && [ 'boat', 'deck', 'seat' ].includes( p.pose.mode );
			out.push( { id, x: aboard ? boat.x : p.pose.position.x, z: aboard ? boat.z : p.pose.position.z, boat, friendly: !! ( p.extra && p.extra.bw === 1 ) } );

		}

		return out;

	}

	// whoever stands nearest c: the local player's spot or a guest's (the stronghold reads x and z)
	_nearest( c, pl ) {

		let best = pl, bd = pl ? Math.hypot( pl.x - c.x, pl.z - c.z ) : Infinity;
		for ( const o of this._others() ) {

			const d = Math.hypot( o.x - c.x, o.z - c.z );
			if ( d < bd ) { bd = d; best = { x: o.x, y: 0, z: o.z }; }

		}

		return best;

	}

	// the batteries' target: the hostile boat nearest the fort, the host's own or a guest's
	_hostTarget() {

		const s = this.s, own = this._orig.target.call( s ), c = s.L.fort || s.L.center;
		let best = own && own.ok !== false && ! own.friendly ? own : null;
		let bd = best ? Math.hypot( best.x - c.x, best.z - c.z ) : Infinity;
		for ( const o of this._others() ) {

			if ( ! o.boat || o.friendly ) continue;
			const d = Math.hypot( o.boat.x - c.x, o.boat.z - c.z );
			if ( d < bd ) { bd = d; best = { ok: true, x: o.boat.x, y: 0, z: o.boat.z, vx: o.boat.vx, vz: o.boat.vz, friendly: false, remote: o.id }; }

		}

		return best || own;

	}

	// ------------------------------------------------------------------ guest

	_act( act, why = '' ) {

		const net = this.net;
		if ( ! net || ! net.online ) return false;
		if ( ! net.sendMsg( { t: 'fort', op: 'act', act, why: typeof why === 'string' ? why : '' } ) ) return false;
		this.stats.actsOut ++;
		return true;

	}

	_reportHostile() {

		if ( this.time - this._hostileSent < FORT_SYNC.hostileEvery ) return;
		this._hostileSent = this.time;
		this._act( 'hostile' );

	}

	_breakStruct( id ) {

		const s = this.s, st = id ? s.structs.get( id ) : null;
		if ( ! st || st.broken ) return;
		s._break( id, 'remote', { remote: true, owned: s._owned( id ) } );

	}

	_restoreStruct( id ) {

		const s = this.s, st = id ? s.structs.get( id ) : null;
		if ( ! st || ! st.broken || s._owned( id ) ) return; // (destruction's own props come back with its respawn)
		s._restore( id );

	}

	_apply( fort ) {

		const s = this.s, net = this.net;
		this._syncClaim( fort );
		if ( ! fort.seq || fort.seq === this._lastSeq ) return; // (no host runs it yet / nothing new)
		this._lastSeq = fort.seq;
		this.stats.applied ++;
		// the holder
		if ( fort.holder === 'pirates' && s.holder === 'player' ) {

			this._allowRetake = true;
			try { this._retake(); } finally { this._allowRetake = false; }

		} else if ( fort.holder === 'player' && s.holder === 'pirates' && fort.by !== net.id && this._orig.claim ) this._orig.claim.call( s, { remote: true } );
		if ( s.holder === 'player' && fort.claimedAt >= 0 ) s.claimedAt = fort.claimedAt;
		// the watch
		const al = s.alarm, prev = al.state;
		if ( fort.alarm !== prev ) {

			al.state = fort.alarm;
			if ( fort.why ) al.why = fort.why;
			if ( fort.alarm === 'alarm' ) {

				al.rings = ( al.rings || 0 ) + 1;
				s._bell( fort.why || 'attack' );

			} else if ( prev === 'alarm' && fort.alarm === 'calm' ) {

				s.toast( 'Blackwater stands down', 2400 );
				s._emit( 'strongholdAlarm', { state: 'calm', why: 'standDown' } );

			}

		}

		// the batteries, their platforms and powder stores
		for ( const b of s.batteries.list ) {

			const fb = fort.batteries.get( b.id );
			if ( ! fb ) continue;
			if ( fb.platform ) this._breakStruct( b.platform ); else this._restoreStruct( b.platform );
			if ( fb.powder ) this._breakStruct( b.powder ); else this._restoreStruct( b.powder );
			if ( fb.silenced && ! b.silenced ) s._silence( b.id, fb.why || 'platform' );
			else if ( ! fb.silenced && b.silenced && s.batteries.restore( b.id ) && s.island ) s.island.setSilenced( b.id, false );

		}

		// the guards on watch (fought here, counted by the host)
		if ( fort.guards !== this._lastGuards ) {

			this._lastGuards = fort.guards;
			if ( fort.guards >= 0 ) {

				s.guardsLeft = fort.guards;
				const act = s.guards.filter( ( r ) => r && r.active );
				for ( let i = act.length - 1; i >= fort.guards && i >= 0; i -- ) {

					act[ i ].beatenOut = true;
					if ( act[ i ].deactivate ) act[ i ].deactivate();

				}

			}

		}

		// the moored ships
		s.ships.forEach( ( sl, i ) => {

			sl.down = !! ( fort.shipsDown & ( 1 << i ) );
			sl.castOff = !! ( fort.castOff & ( 1 << i ) );

		} );

	}

	// ------------------------------------------------------------------ everybody

	// a fort structure the destruction feature owns, broken on another machine: its battery is silenced here too
	_onRemoteEvent( e ) {

		if ( ! e || e.kind !== 'propDestroyed' || ! e.data ) return;
		const s = this.s, id = e.data.id;
		if ( ! s || ! s.structs || typeof id !== 'string' ) return;
		const st = s.structs.get( id );
		if ( ! st || st.broken || ! s._owned( id ) ) return;
		s._break( id, 'remote', { owned: true, remote: true } );

	}

	// near Blackwater the state says whether the brotherhood lets this player in (the host's batteries hold fire for her)
	decorate( st ) {

		const s = this.s;
		if ( ! s || ! s.L || ! st || ! Array.isArray( st.p ) ) return st;
		const at = st.boat && Array.isArray( st.boat.p ) ? st.boat.p : st.p, c = s.L.center;
		if ( Math.hypot( at[ 0 ] - c.x, at[ 2 ] - c.z ) > FORT_SYNC.near ) return st;
		let f = false;
		try { f = !! s.friendly(); } catch ( e ) { /* hostile */ }
		st.bw = f ? 1 : 0;
		return st;

	}

	update( dt ) {

		this.time += dt;
		const s = this.s, net = this.net, fort = this._fort();
		if ( s !== this._s ) {

			this._unpatch();
			this.role = 'solo';
			this._s = s;

		}

		let role = 'solo';
		if ( s && net && fort ) role = net.online ? ( net.isHost ? 'host' : 'guest' ) : this.role; // (a dropped link keeps its role)
		if ( role !== this.role ) this._setRole( role );
		if ( ! net || ! net.online || ! fort || role === 'solo' ) return;
		if ( role === 'host' ) this._hostTick( dt, fort );
		else this._apply( fort );

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		if ( this._fOff ) this._fOff();
		this._fOff = null;
		this._unpatch();
		this.role = 'solo';

	}

}
