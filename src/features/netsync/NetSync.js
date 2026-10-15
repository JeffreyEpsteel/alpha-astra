// Multiplayer extras on top of the relay: crew codes, passengers on another player's boat, and the shared ships.
//
//   const sync = app.features.get( 'netsync' );        // installed by features/install.js; app.netsync = sync is handy
//   sync.net                  the current NetClient (rebinds itself when App.connect() builds a new one), or null
//   sync.online / sync.isHost / sync.crewCode / sync.members()
//   sync.createCrew() -> Promise<code>   sync.joinCrew( code ) -> bool        (connects first when offline)
//   sync.openPanel() / closePanel() / isOpen() / close()                      the Crew panel (CrewPanel.js)
//   sync.openToGuests, sync.setOpenToGuests( bool )                           take passengers (default yes)
//
// Passengers: near a remote player's slow boat the E prompt reads "Ride with <name>" (a Features interactable); E sends
// { t: 'ride', host }; the server checks range / seats / the host's policy and answers 'ride' (seated) or 'rideNo'.
//   sync.riding               null | { host, seat, name }                    the local player is a guest
//   sync.ridePose( out )      -> out | null: { position {x,y,z}, quaternion {x,y,z,w}, seatYaw, yaw, boatId, hostName, valid }
//                             the seat in world space from the host boat's interpolated transform; the Player calls it
//                             BEFORE its own update and, while riding, sits there instead of walking (see the report)
//   sync.decorateState( state ) -> state   App.netState() passes its state through it: mode 'ride', ride, seat, p, yaw
//   sync.stepOff()            leave the seat: the player is put on the nearest shore (or in the water beside the boat)
//   sync.guests               ids riding with the local player
// E again while riding reads "Step off".
//
// Ships and cannon fire: NavalLink.js (host simulates and sends 5 Hz; the rest render puppets; shots are effects; hits are reported).
//
// World events (any room; the persistent universe also stores the kinds Protocol.WORLD_EVENT_RULES knows):
//   app.netsync.sendWorldEvent( kind, data ) -> bool   to everybody else online (never echoed back; false offline)
//   features.on( 'remoteWorldEvent', ( { kind, data, from, at, replay } ) => ... )   another player's event, or the server's
//                             (from 'server': propRespawned { id }, boatMoored, boatUnmoored). replay: true for the stored
//                             events a universe hands over on every (re)join: handlers must be idempotent.
// The universe (net.universe):
//   sync.universe             null | { name, day, seed, bountySeed, captain }; features.emit( 'universeJoined', that ) on join
//   sync.bountySeed()         the shared bounty seed (null outside a universe)
//   sync.moored               Map captain -> { name, boat, p, q }: offline captains' boats, shown by RemotePlayers.setMoored
//   the market: the world host sends trade.marketSnapshot() (on trade.onMarketChange, at most every 5 s); everybody else
//   adopts the host's / the stored one with trade.adoptMarketSnapshot( snap ); app.universe (Universe.js) gets each NetClient
// decorateState keeps every field another feature put on the state (out.plane...): the server passes them through.
//
// Wave 11, the waves 9-10 features for everybody in the room:
//   sync.hulls  (HullLink.js)   remote boats are solid: the host resolves their hull collisions with the ships, its own boat
//                               and each other and sends each owner its impulse + damage ('bump'); every client pushes its
//                               own boat clear of the remote hulls it draws. The state carries hv: [ vx, vz, w, mass, maxHp ].
//   sync.wrecks (WreckLink.js)  sinking boats, boat wrecks and seaplane wrecks as entries of the room's schema (wrecks),
//                               drawn by naval Wrecks / Planks and seaplane Wreck + PlaneVisual in a passive mode
//   sync.crew   (CrewLink.js)   the posted crew rides in the state (crew: [ [ id, post, side, slot ] ]); remote boats show
//                               them with crew/Deck.js
//   cannon fire carries its side and crew gunner (fx sd, c); the server drops shots and gunshots faster than the reload
//   (Protocol.FireGate) and relays the host's 'ram' effects. All of it survives a reconnect (schema + state, re-sent wrecks).
//
// Wave 13, the wave 12 features for everybody in the room:
//   sync.planes (PlaneLink.js)  the others' airframes with livery and upgrades (state plane.af / liv / up), a pilot under the
//                               parachute (state chute), the plane she bailed out of streamed as a schema 'stray' entry until it
//                               wrecks, each player's airframe out as a 'parked' entry (the Kestrel on the airstrip pad). The
//                               pilot's mode 'plane' goes as 'seat' (it is not a protocol mode: such a state was refused).
//   sync.fort   (StrongholdLink.js)  Blackwater, host-authoritative: alarm, batteries, powder, guards, moored ships and the
//                               claim (granted once by the server; the claimant takes the loot) in the schema's `fort`
//   sync.town   (TownLink.js)   the host's prop respawns go to everybody (batched); sync.hostOnly() / sync.askHost( kind, data )
//                               -> features 'hostRequest' { kind, data, from, local } on the host (a raid only the host spawns)
// Wave 16A: sync.rescue (RescueLink.js) a guest's rescue launch rides its state (rl) and the others draw it; the boats a player
//                               left moored (hijack.left, state lb) join the moored list (sync.moored 'left:<peer>:<n>').
// Wave 20E, the wave 19 features for everybody in the room:
//   sync.law    (NavyLink.js)   each player's wanted / hostile mark rides his state (nw) into every navy's book; the host's hails
//                               go to their player alone, numbered and resent until acknowledged (a reconnect mid-hail fines once).
//                               The navy's 'navyWanted' world events are not sent (the state says it); 'navyHail' goes through here.
//   sync.rooms  (InteriorLink.js) players inside a room are hidden from those outside it (peer.hiddenIndoor); a tavern hand hired
//                               by one player is not offered to another: sync.handTaken( id ) (world event 'handHired').
//   the crew    (CrewLink.js)   cooks, lookouts and tavern hands with their activity, as one compact string
//   the navy    (NavalLink.js)  no navy of its own on a guest, no local damage to the host's ships, every sinking for everybody
//   weather     the weather's clock is put on the server's time (weather.now minus net.serverOffset): a skewed computer clock
//               no longer moves the storm fronts and their lightning (Fronts.js is a function of the island hour)
//   sync.id     the local player's id in the room (null offline): the hijack feature names the taker with it
// Wave 22A: sync.cars (CarLink.js) the players' cars (state car / oc / cw), the host's traffic and police for every player in
//                               Meridian (the server's 'cars' message), a car taken from the host's traffic is the taker's.

import { BOATS } from '../../game/Boats.js';
import { CrewPanel } from './CrewPanel.js';
import { NavalLink } from './NavalLink.js';
import { HullLink } from './HullLink.js';
import { WreckLink } from './WreckLink.js';
import { CrewLink } from './CrewLink.js';
import { PlaneLink } from './PlaneLink.js';
import { StrongholdLink } from './StrongholdLink.js';
import { TownLink } from './TownLink.js';
import { RescueLink } from './RescueLink.js';
import { NavyLink } from './NavyLink.js';
import { InteriorLink } from './InteriorLink.js';
import { CarLink } from './CarLink.js';
import { crewCodeFromLocation } from '../../net/NetClient.js';
import { crewUrl } from '../../net/Protocol.js';

const SLOW = 2.5; // m/s: a boat this slow can be boarded
const HV_STEP = { v: 0.4, w: 0.06 }; // m/s, rad/s: a change of way worth a new hv (collisions judge closing speeds in m/s)
const HEAVE = 6; // m: the E radius around a rideable boat's origin, plus half its length

const rotate = ( q, x, y, z, out ) => {

	// v' = v + 2w(q x v) + 2 q x (q x v)
	const tx = 2 * ( q.y * z - q.z * y ), ty = 2 * ( q.z * x - q.x * z ), tz = 2 * ( q.x * y - q.y * x );
	out.x = x + q.w * tx + ( q.y * tz - q.z * ty );
	out.y = y + q.w * ty + ( q.z * tx - q.x * tz );
	out.z = z + q.w * tz + ( q.x * ty - q.y * tx );
	return out;

};

export class NetSync {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = opts;
		this.net = null;
		this.riding = null;
		this.pending = null; // { host, at }: a ride request waiting for the server
		this.openToGuests = true;
		this.guests = [];
		this.naval = new NavalLink( this );
		this.hulls = new HullLink( this );
		this.wrecks = new WreckLink( this );
		this.crew = new CrewLink( this );
		this.planes = new PlaneLink( this );
		this.fort = new StrongholdLink( this );
		this.town = new TownLink( this );
		this.rescue = new RescueLink( this ); // (wave 16A: a guest's rescue launch, the boats left moored)
		this.law = new NavyLink( this ); // (wave 20E: wanted marks, hails)
		this.rooms = new InteriorLink( this ); // (wave 20E: interiors, tavern hands)
		this.cars = new CarLink( this ); // (wave 22A: the players' cars, the host's traffic and police)
		this._clock = null; // { weather, now }: the weather's own clock while it runs on the server's time
		this.panel = null;
		this._offs = [];
		this._speeds = new Map(); // peer id -> { x, z, t, v }: boat speed from the interpolated transform
		this._anchor = null; // the last host boat transform while riding: { x, y, z, q, boatId, name }
		this._candidate = null;
		this._rp = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, seatYaw: 0, yaw: 0, boatId: null, hostName: '', valid: false };
		this._tmp = { x: 0, y: 0, z: 0 };
		this._off = features && features.interactable ? features.interactable( {
			id: 'netsync.ride',
			radius: HEAVE + 8,
			position: () => this._interactPos(),
			when: () => !! ( this.riding || this._candidate ),
			prompt: () => this.riding ? 'Step off' : this._candidate ? `Ride with ${ this._candidate.name }` : null,
			onInteract: () => ( this.riding ? this.stepOff() : this.requestRide( this._candidate && this._candidate.id ) ),
		} ) : null;
		this.crewFromPage = crewCodeFromLocation();
		this.universe = null;
		this.moored = new Map();
		this._market = { dirty: true, acc: 0, poll: 0, sig: '', off: null, trade: null };
		this._chatReplayed = false;

	}

	// ------------------------------------------------------------------ state

	get online() {

		return !! ( this.net && this.net.online );

	}

	get isHost() {

		return !! ( this.net && this.net.isHost );

	}

	get crewCode() {

		return this.net ? this.net.crewCode : null;

	}

	// the local player's id in the room (null offline)
	get id() {

		return this.net && this.net.online ? this.net.id : null;

	}

	// a tavern hand who signed on with another player's ship (InteriorLink)
	handTaken( id ) {

		return this.rooms.handTaken( id );

	}

	// everybody in the room, the local player first: { id, name, self, host, riding, aboard }
	members() {

		const net = this.net;
		if ( ! net || ! net.online ) return [];
		const out = [ { id: net.id, name: this.app.game && this.app.game.state && this.app.game.state.name || net.name, self: true, host: net.host === net.id, riding: this.riding ? this.riding.host : null, aboard: net.rides ? [ ...net.rides ].filter( ( [ , r ] ) => r.host === net.id ).length : 0 } ];
		for ( const [ id, p ] of net.peers ) {

			const r = net.rides.get( id );
			out.push( {
				id, name: p.name || '?', self: false, host: net.host === id, riding: r ? r.host : null,
				aboard: [ ...net.rides ].filter( ( [ , x ] ) => x.host === id ).length,
			} );

		}

		return out;

	}

	nameOf( id ) {

		const net = this.net;
		if ( ! net ) return '?';
		if ( id === net.id ) return 'you';
		const p = net.peers.get( id );
		return p ? p.name || '?' : '?';

	}

	toast( text, ms = 2600 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	// ------------------------------------------------------------------ world events and the universe

	// a world event to everybody else online (a destroyed prop, a claimed bounty...); the universe keeps the known kinds
	sendWorldEvent( kind, data = {} ) {

		const net = this.net;
		if ( ! net || ! net.online || ! net.sendEvent ) return false;
		// a wreck is an entry of the room's state now (WreckLink): the naval feature's events stay home
		if ( ( kind === 'wreck' || kind === 'wreckSalvaged' ) && this.wrecks.supported ) return true;
		// the wanted mark rides the state (nw, NavyLink); a hail is numbered, addressed and resent until acknowledged
		if ( kind === 'navyWanted' ) return true;
		if ( kind === 'navyHail' ) return this.law.sendHail( data );
		return net.sendEvent( kind, data );

	}

	// true offline or on the room's host: the caller may change the shared world (spawn a raider...)
	hostOnly() {

		return this.town.hostOnly();

	}

	// run something on the room's host (features 'hostRequest' there; here at once when this is the host or offline)
	askHost( kind, data = {} ) {

		return this.town.askHost( kind, data );

	}

	bountySeed() {

		return this.universe ? this.universe.bountySeed : null;

	}

	_emit( type, payload ) {

		const f = this.features;
		if ( f && f.emit ) {

			try {

				f.emit( type, payload );

			} catch ( e ) {

				console.warn( `netsync: ${ type } listener threw`, e );

			}

		}

	}

	_onEvent( m, replay = false ) {

		if ( ! m || typeof m.kind !== 'string' ) return;
		if ( m.kind === 'propsRespawned' ) {

			// the host's town coming back, one prop at a time for the features
			for ( const e of this.town.expand( m ) ) this._onEvent( e, replay );
			return;

		}

		const data = m.data && typeof m.data === 'object' ? m.data : {};
		// a hail for somebody else, or one we have heard already (a resend): nobody here hears it
		if ( m.kind === 'navyHail' && ! this.law.accept( m ) ) return;
		if ( m.kind === 'handHired' ) this.rooms.onEvent( m.kind, data );
		if ( m.kind === 'boatMoored' && typeof data.captain === 'string' ) {

			this.moored.set( data.captain, data );
			this._showMoored();

		} else if ( m.kind === 'boatUnmoored' && typeof data.captain === 'string' ) {

			if ( this.moored.delete( data.captain ) ) this._showMoored();

		}

		this._emit( 'remoteWorldEvent', { kind: m.kind, data, from: m.from || 'server', at: m.at || Date.now(), replay } );

	}

	_showMoored() {

		const rp = this.app.remotePlayers;
		if ( rp && rp.setMoored ) rp.setMoored( [ ...this.moored.values() ] );

	}

	// a universe welcome: its header, the stored world events, the offline captains' boats, the market, the chat log
	_onUniverseWelcome( net ) {

		const info = net.universeInfo;
		if ( ! info ) {

			this.universe = null;
			if ( this.moored.size ) {

				this.moored.clear();
				this._showMoored();

			}

			return;

		}

		this.universe = { name: info.name, day: info.day, seed: info.seed, bountySeed: info.bountySeed, captain: net.captain };
		const w = net.world || {};
		this.moored.clear();
		for ( const b of Array.isArray( w.boats ) ? w.boats : [] ) if ( b && typeof b.captain === 'string' ) this.moored.set( b.captain, b );
		this._showMoored();
		for ( const e of Array.isArray( w.events ) ? w.events : [] ) this._onEvent( e, true );
		if ( w.market ) this._adoptMarket( w.market );
		const rp = this.app.remotePlayers;
		if ( ! this._chatReplayed && rp && rp.pushChat && Array.isArray( w.chat ) ) {

			// the last few lines of the universe's chat, once per session
			this._chatReplayed = true;
			for ( const c of w.chat.slice( - 4 ) ) if ( c && c.text ) rp.pushChat( c.system ? { system: true, text: c.text } : { name: c.name, text: c.text } );

		}

		this._market.dirty = true;
		this._emit( 'universeJoined', { ...this.universe } );
		this.toast( `Universe ${ info.name } · day ${ ( info.day | 0 ) + 1 }`, 2600 );

	}

	_trade() {

		const f = this.features;
		return f && f.get ? f.get( 'trade' ) : null;

	}

	_adoptMarket( sim ) {

		const t = this._trade();
		if ( ! t || ! sim || typeof t.adoptMarketSnapshot !== 'function' ) return false;
		try {

			t.adoptMarketSnapshot( sim );
			this._market.sig = JSON.stringify( sim );
			return true;

		} catch ( e ) {

			console.warn( 'netsync: market snapshot refused', e );
			return false;

		}

	}

	// the world host of a universe sends its market when it changed (onMarketChange, else a 15 s comparison)
	_updateMarket( dt ) {

		const net = this.net, mk = this._market, t = this._trade();
		if ( t !== mk.trade ) {

			if ( mk.off ) mk.off();
			mk.off = null;
			mk.trade = t;
			if ( t && typeof t.onMarketChange === 'function' ) {

				const off = t.onMarketChange( () => { mk.dirty = true; } );
				mk.off = typeof off === 'function' ? off : null;

			}

		}

		if ( ! net || ! net.online || ! net.universe || ! net.isHost || ! t || typeof t.marketSnapshot !== 'function' ) return;
		mk.acc += dt;
		mk.poll += dt;
		if ( mk.poll >= 15 ) {

			mk.poll = 0;
			mk.dirty = true;

		}

		if ( ! mk.dirty || mk.acc < 5 ) return;
		mk.acc = 0;
		mk.dirty = false;
		let snap = null;
		try {

			snap = t.marketSnapshot();

		} catch ( e ) {

			return;

		}

		const sig = snap ? JSON.stringify( snap ) : '';
		if ( ! sig || sig === mk.sig ) return;
		if ( net.sendMarket( snap ) ) mk.sig = sig;

	}

	// ------------------------------------------------------------------ crews

	async _ensureOnline( url = null ) {

		if ( this.online ) return true;
		const app = this.app;
		if ( ! this.net && app.connect ) app.connect( url || ( app.serverUrl ? app.serverUrl() : undefined ) );
		const t0 = Date.now();
		while ( Date.now() - t0 < 7000 ) {

			if ( this.online ) return true;
			await new Promise( ( r ) => setTimeout( r, 100 ) );

		}

		return false;

	}

	// a fresh crew code, and this client moves into its room
	async createCrew() {

		if ( ! await this._ensureOnline() ) throw new Error( 'not connected' );
		const code = await this.net.createCrew();
		this.toast( `Crew ${ code.toUpperCase() } created: share the code`, 3200 );
		return code;

	}

	// join a crew by its code (connects first when offline)
	async joinCrew( code ) {

		const c = String( code || '' ).trim().toLowerCase();
		if ( ! /^[a-z]{6}$/.test( c ) ) throw new Error( 'a crew code is six letters' );
		if ( ! this.net ) {

			const base = this.app.serverUrl ? this.app.serverUrl() : undefined;
			const url = base ? crewUrl( base, c ) : null;
			if ( ! url || ! this.app.connect ) throw new Error( 'no server' );
			this.app.connect( url );
			return true;

		}

		if ( ! this.net.joinCrew( c ) ) throw new Error( 'bad crew code' );
		return true;

	}

	setOpenToGuests( open ) {

		this.openToGuests = open !== false;
		if ( this.net && this.net.online ) this.net.setRidePolicy( this.openToGuests );

	}

	// ------------------------------------------------------------------ panel

	openPanel() {

		if ( ! this.panel ) this.panel = new CrewPanel( this );
		this.panel.open();
		return this.panel;

	}

	togglePanel() {

		if ( this.isOpen() ) this.closePanel();
		else this.openPanel();

	}

	closePanel() {

		if ( this.panel ) this.panel.close();

	}

	isOpen() {

		return !! ( this.panel && this.panel.isOpen );

	}

	close() {

		this.closePanel();

	}

	// ------------------------------------------------------------------ passengers

	_interactPos() {

		if ( this.riding ) {

			const p = this.app.player;
			return p ? p.position : null;

		}

		return this._candidate ? this._candidate.pos : null;

	}

	// the remote boat the local player can climb into, or null
	_findCandidate() {

		const app = this.app, net = this.net, rp = app.remotePlayers, player = app.player;
		if ( this.riding || this.pending || ! net || ! net.online || ! rp || ! player ) return null;
		if ( player.mode === 'boat' || player.mode === 'deck' || player.mode === 'seat' ) return null;
		const px = player.position.x, py = player.position.y, pz = player.position.z;
		let best = null, bd = Infinity;
		for ( const [ id, p ] of rp.peers ) {

			if ( ! p.boatState || ! p.hasPose || p.riding || net.closed.has( id ) || net.rides.has( id ) ) continue;
			const spec = BOATS[ p.boatState.id ];
			const seats = spec && spec.seats ? Math.max( 1, spec.seats.length ) : 1;
			let taken = 0;
			for ( const [ , r ] of net.rides ) if ( r.host === id ) taken ++;
			if ( taken >= seats ) continue;
			const sp = this._speeds.get( id );
			if ( ! sp || sp.v > SLOW ) continue;
			const d = Math.hypot( p.boatPos.x - px, p.boatPos.z - pz );
			const reach = HEAVE + ( spec ? spec.length * 0.5 : 2 );
			if ( d > reach || Math.abs( p.boatPos.y - py ) > 4 || d >= bd ) continue;
			bd = d;
			best = { id, name: p.name, pos: p.boatPos, distance: d };

		}

		return best;

	}

	_trackSpeeds( dt ) {

		const rp = this.app.remotePlayers;
		if ( ! rp ) return;
		const now = performance.now();
		for ( const [ id, p ] of rp.peers ) {

			if ( ! p.boatState || ! p.hasPose ) continue;
			let s = this._speeds.get( id );
			if ( ! s ) {

				this._speeds.set( id, s = { x: p.boatPos.x, z: p.boatPos.z, t: now, v: 0 } );
				continue;

			}

			const dtt = ( now - s.t ) / 1000;
			if ( dtt < 0.1 ) continue;
			const v = Math.hypot( p.boatPos.x - s.x, p.boatPos.z - s.z ) / dtt;
			s.v += ( v - s.v ) * Math.min( 1, dtt * 2.5 );
			s.x = p.boatPos.x;
			s.z = p.boatPos.z;
			s.t = now;

		}

		for ( const id of [ ...this._speeds.keys() ] ) if ( ! rp.peers.has( id ) ) this._speeds.delete( id );

	}

	requestRide( hostId ) {

		const net = this.net;
		if ( ! hostId || ! net || ! net.online || this.riding || this.pending ) return false;
		this.pending = { host: hostId, at: Date.now() };
		net.ride( hostId );
		return true;

	}

	_onRide( m ) {

		const net = this.net;
		if ( ! net ) return;
		if ( m.guest === net.id ) {

			this.pending = null;
			this.riding = { host: m.host, seat: m.seat | 0, name: this.nameOf( m.host ) };
			this._anchor = null;
			this.closePanel();
			this.toast( `Riding with ${ this.riding.name } (E to step off)`, 2800 );

		} else if ( m.host === net.id ) {

			this.toast( `${ this.nameOf( m.guest ) } came aboard`, 2200 );

		}

		this.guests = [ ...net.rides ].filter( ( [ , r ] ) => r.host === net.id ).map( ( [ g ] ) => g );

	}

	_onUnride( m ) {

		const net = this.net;
		if ( ! net ) return;
		if ( m.guest === net.id ) {

			if ( this.riding ) {

				const why = { gone: 'The boat is gone', noboat: 'The boat is gone', closed: 'The skipper took no more guests', left: null }[ m.reason ];
				this._putAshore();
				if ( why ) this.toast( why, 2600 );

			}

			this.pending = null;

		} else if ( m.host === net.id && m.reason === 'left' ) this.toast( `${ this.nameOf( m.guest ) } stepped off`, 2000 );

		this.guests = [ ...net.rides ].filter( ( [ , r ] ) => r.host === net.id ).map( ( [ g ] ) => g );

	}

	_onRideNo( m ) {

		this.pending = null;
		const text = {
			full: 'The boat is full', range: 'Too far from the boat', closed: 'That skipper takes no guests', noboat: 'No boat there',
			busy: 'You are already riding', hostRiding: 'They are a guest themselves', gone: 'They are gone',
		}[ m.reason ] || 'Cannot ride';
		this.toast( text, 2200 );

	}

	// the seat in world space from the host boat as the client shows it (null when it is not there)
	ridePose( out = this._rp ) {

		const r = this.riding, rp = this.app.remotePlayers;
		if ( ! r ) return null;
		const a = rp ? rp.anchor( r.host ) : null;
		if ( ! a ) {

			// the host boat is not in view (a hiccup): hold the last seat
			if ( this._anchor ) return this._fromAnchor( out, this._anchor, r );
			out.valid = false;
			return null;

		}

		const an = this._anchor || ( this._anchor = {} );
		an.x = a.position.x; an.y = a.position.y; an.z = a.position.z;
		an.q = an.q || {};
		an.q.x = a.quaternion.x; an.q.y = a.quaternion.y; an.q.z = a.quaternion.z; an.q.w = a.quaternion.w;
		an.boatId = a.id;
		return this._fromAnchor( out, an, r );

	}

	_fromAnchor( out, an, r ) {

		const spec = BOATS[ an.boatId ];
		const seats = spec && spec.seats && spec.seats.length ? spec.seats : [ { x: 0, z: 0, yaw: 0 } ];
		const seat = seats[ Math.min( r.seat, seats.length - 1 ) ];
		rotate( an.q, seat.x, spec && spec.deckY !== undefined ? spec.deckY : 0.3, seat.z, this._tmp );
		out.position.x = an.x + this._tmp.x;
		out.position.y = an.y + this._tmp.y;
		out.position.z = an.z + this._tmp.z;
		out.quaternion.x = an.q.x; out.quaternion.y = an.q.y; out.quaternion.z = an.q.z; out.quaternion.w = an.q.w;
		out.seatYaw = seat.yaw;
		out.yaw = seat.yaw + Math.PI;
		out.boatId = an.boatId;
		out.hostName = r.name;
		out.valid = true;
		return out;

	}

	// App.netState() passes its state here; a guest sends mode 'ride' at the seat
	decorateState( s ) {

		// other features' per-player fields (the seaplane's out.plane...) ride along: the server passes them through
		const plane = this.features && this.features.get ? this.features.get( 'seaplane' ) : null;
		if ( plane && typeof plane.decorateState === 'function' ) {

			try { plane.decorateState( s ); } catch ( e ) { /* its fields are optional */ }

		}

		// the airframe's upgrades, the parachute, a pilot seated (mode 'plane' is no protocol mode); near Blackwater: let in?
		try { this.planes.decorate( s ); } catch ( e ) { /* optional */ }
		try { this.features?.get?.( 'helicopter' )?.decorateState?.( s ); } catch ( e ) { /* optional */ }
		try { this.features?.get?.( 'cars' )?.decorateState?.( s ); } catch ( e ) { /* optional */ }
		try { this.fort.decorate( s ); } catch ( e ) { /* optional */ }
		try { this.rescue.decorate( s ); } catch ( e ) { /* optional */ }

		if ( ! this.riding ) {

			// aboard her own boat: its way, mass and hull for the host's collisions; the posted crew for the others' decks
			this._hullState( s );
			try { this.crew.decorate( s ); } catch ( e ) { /* optional */ }
			try { this.law.decorate( s ); } catch ( e ) { /* optional */ }
			return s;

		}

		const p = this.ridePose();
		if ( p ) {

			s.p = [ p.position.x, p.position.y, p.position.z ];
			s.yaw = p.yaw;

		}

		try { this.law.decorate( s ); } catch ( e ) { /* optional */ }
		s.mode = 'ride';
		s.ride = this.riding.host;
		s.seat = this.riding.seat;
		s.speed = 0;
		s.vy = 0;
		s.grounded = true;
		s.diving = false;
		s.action = null;
		return s;

	}

	// hv: [ vx, vz, yaw rate, mass, max hull ] of the local boat (HullLink on the host reads it). Wave 20E: the last sent one is
	// kept until the way changes by HV_STEP (or the mass / hull do): the state's extras then stay the same string between real
	// changes and the room's patches leave them out (a boat on a steady course used to resend all its extras 15 times a second)
	_hullState( s ) {

		const b = this.app.boatCtl;
		if ( ! s || ! s.boat || ! b || ! b.velocity ) return;
		const n = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		const spec = BOATS[ s.boat.id ];
		const r1 = ( v ) => Math.round( ( Number.isFinite( v ) ? v : 0 ) * 10 ) / 10;
		const vx = r1( b.velocity.x ), vz = r1( b.velocity.z ), w = Math.round( ( b.angular ? b.angular.y : 0 ) * 100 ) / 100 || 0;
		const mass = Math.round( b.mass || ( spec ? spec.mass : 0 ) || 0 ), hp = Math.round( n && n.playerHull ? n.playerHull.max : 0 );
		const last = this._hv;
		if ( ! last || last[ 3 ] !== mass || last[ 4 ] !== hp || Math.abs( last[ 0 ] - vx ) >= HV_STEP.v || Math.abs( last[ 1 ] - vz ) >= HV_STEP.v || Math.abs( last[ 2 ] - w ) >= HV_STEP.w
			|| ( ( vx || vz || w ) === 0 ) !== ( ( last[ 0 ] || last[ 1 ] || last[ 2 ] ) === 0 ) ) this._hv = [ vx, vz, w, mass, hp ];
		s.hv = this._hv;

	}

	stepOff() {

		if ( ! this.riding ) return false;
		if ( this.net ) this.net.unride();
		this._putAshore();
		return true;

	}

	// the guest ends up on the nearest shore within 14 m of the boat, else in the water beside it
	_putAshore() {

		const an = this._anchor;
		this.riding = null;
		this._anchor = null;
		const app = this.app, T = app.terrainData;
		if ( ! an || ! T || ! app.player ) return;
		const spec = BOATS[ an.boatId ] || {};
		const beam = spec.beam || 2.5;
		const heightAt = ( x, z ) => {

			let h = T.heightAt( x, z );
			if ( app.colliders && app.colliders.groundHeightAt ) h = Math.max( h, app.colliders.groundHeightAt( x, z, 50 ) );
			return h;

		};

		let spot = null;
		for ( let r = 2.5; r <= 14 && ! spot; r += 1.5 ) {

			const n = Math.max( 12, Math.round( r * 3 ) );
			let bh = - Infinity;
			for ( let i = 0; i < n; i ++ ) {

				const a = ( i / n ) * Math.PI * 2;
				const x = an.x + Math.sin( a ) * r, z = an.z + Math.cos( a ) * r;
				const h = heightAt( x, z );
				if ( h > 0.35 && h < 4 && h > bh ) {

					bh = h;
					spot = { x, y: h, z };

				}

			}

		}

		let yaw = app.player.yaw;
		if ( ! spot ) {

			rotate( an.q, beam * 0.5 + 0.9, 0, 0, this._tmp );
			spot = { x: an.x + this._tmp.x, y: an.y - 0.2, z: an.z + this._tmp.z };

		} else yaw = Math.atan2( an.x - spot.x, an.z - spot.z ) + Math.PI;

		if ( app._placePlayer ) app._placePlayer( spot.x, spot.y, spot.z, yaw );
		else {

			app.player.position.set( spot.x, spot.y, spot.z );
			app.player.mode = 'walk';

		}

	}

	// ------------------------------------------------------------------ frame

	_bind( net ) {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.net = net;
		this.riding = null;
		this.pending = null;
		this.guests = [];
		this._anchor = null;
		this._speeds.clear();
		this.naval.bind( net );
		this.hulls.bind( net );
		this.wrecks.bind( net );
		this.planes.bind( net );
		this.fort.bind( net );
		this.town.bind( net );
		this.rescue.bind( net );
		this.cars.bind( net );
		this.crew.clear();
		this.law.clear();
		if ( ! net ) {

			this.universe = null;
			this.moored.clear(); // (RemotePlayers went with the connection)
			if ( this.app.universe && this.app.universe.bind ) this.app.universe.bind( null );
			return;

		}

		this._offs.push( net.on( 'ride', ( m ) => this._onRide( m ) ) );
		this._offs.push( net.on( 'unride', ( m ) => this._onUnride( m ) ) );
		this._offs.push( net.on( 'rideNo', ( m ) => this._onRideNo( m ) ) );
		this._offs.push( net.on( 'welcome', () => {

			// a closed boat stays closed over a reconnect / a crew change
			if ( ! this.openToGuests ) net.setRidePolicy( false );
			if ( net.crewCode ) this.toast( `Crew ${ net.crewCode.toUpperCase() }`, 2200 );
			this._onUniverseWelcome( net );

		} ) );
		this._offs.push( net.on( 'event', ( m ) => this._onEvent( m, false ) ) );
		this._offs.push( net.on( 'market', ( m ) => { if ( ! net.isHost ) this._adoptMarket( m.sim ); } ) );
		// the session that keeps the captain's game on the server (src/net/Universe.js) follows the connection
		if ( this.app.universe && this.app.universe.bind ) this.app.universe.bind( net );
		if ( net.online ) this._onUniverseWelcome( net );
		this._offs.push( net.on( 'host', ( m ) => {

			if ( m.id === net.id ) this.toast( 'You run the ships now', 2400 );

		} ) );

	}

	update( dt ) {

		const app = this.app;
		if ( app.net !== this.net ) this._bind( app.net || null );
		const net = this.net, rp = app.remotePlayers;
		if ( net && rp ) {

			rp.localId = net.id;
			if ( ! rp.localBoat ) rp.localBoat = () => {

				const st = app.game && app.game.state, b = app.boatCtl;
				return st && st.boat && b ? { id: st.boat, position: b.position, quaternion: b.quaternion } : null;

			};

		}

		if ( net && net.online ) {

			if ( this.pending && Date.now() - this.pending.at > 4000 ) this.pending = null;
			this._trackSpeeds( dt );
			this._candidate = this._findCandidate();
			if ( this.riding && ! net.peers.has( this.riding.host ) ) this._onUnride( { guest: net.id, host: this.riding.host, reason: 'gone' } );

		} else {

			this._candidate = null;
			if ( this.riding ) this._putAshore();

		}

		this.naval.update( dt );
		this.hulls.update( dt );
		this.wrecks.update( dt );
		this.crew.update( dt );
		this.planes.update( dt ); // (feeds seaplane.updateRemote with the others' new plane states)
		this.fort.update( dt );
		this.town.update( dt );
		this.rescue.update( dt );
		this.law.update( dt );
		this.rooms.update( dt );
		this.cars.update( dt );
		this._serverClock();
		this._updateMarket( dt );
		if ( net && net.universe ) {

			// a dropped universe connection says so once; NetClient retries with a growing pause (1 s .. 15 s)
			const was = this._lastStatus;
			this._lastStatus = net.status;
			if ( was === 'online' && net.status !== 'online' && net.status !== 'error' ) this.toast( 'Universe connection lost: reconnecting (your game is kept and sent when back)', 3200 );

		}

		// a universe session attached after the connection (the menu) still gets this client
		const u = app.universe;
		if ( u && u.bind && u.net !== this.net ) u.bind( this.net );

	}

	// the weather on the server's time: Weather._time reads the clock message's `at` (the server's Date.now()) against its own
	// now(); a computer clock 30 s off put every front 30 s of island time (330 m) off the others'. Its now() becomes the
	// server's (net.serverOffset, smoothed from the pongs) while online, and its own again offline.
	_serverClock() {

		const f = this.features, w = f && f.get ? f.get( 'weather' ) : null;
		const net = this.net, c = this._clock;
		const on = !! ( w && typeof w.now === 'function' && net && net.online );
		if ( c && ( ! on || c.weather !== w ) ) {

			if ( c.weather && c.weather.now === c.fn ) c.weather.now = c.now;
			this._clock = null;

		}

		if ( ! on || this._clock ) return;
		const now = w.now;
		const fn = () => now.call( w ) - ( this.net && Number.isFinite( this.net.serverOffset ) ? this.net.serverOffset : 0 );
		w.now = fn;
		this._clock = { weather: w, now, fn };

	}

	dispose() {

		if ( this._clock && this._clock.weather.now === this._clock.fn ) this._clock.weather.now = this._clock.now;
		this._clock = null;
		for ( const off of this._offs ) off();
		this._offs.length = 0;
		if ( this._market.off ) this._market.off();
		this._market.off = null;
		if ( this._off ) this._off();
		this.naval.dispose();
		this.hulls.dispose();
		this.wrecks.dispose();
		this.crew.dispose();
		this.planes.dispose();
		this.fort.dispose();
		this.town.dispose();
		this.rescue.dispose();
		this.rooms.clear();
		this.rooms.dispose();
		this.cars.dispose();
		if ( this.panel ) this.panel.dispose();
		this.panel = null;
		this.net = null;

	}

}
