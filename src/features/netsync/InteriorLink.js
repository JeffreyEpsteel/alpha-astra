// The walk-in interiors and the tavern hands for everybody in the room (wave 20E, the wave 19C / 19E features in multiplayer).
//
//   rooms    nothing is sent: a player's state already places him inside a room's shell (the rooms are built from the same
//            layouts on every client). Five times a second each remote peer is looked up in the interiors feature's rooms
//            (Interiors.contains): peer.indoor = the room id or null, and peer.hiddenIndoor = true while he is inside a room
//            the local player is not in (his avatar and name tag are not drawn through the shell's walls and doorway from
//            outside; RemotePlayers reads hiddenIndoor, see the report's patch). Two players in the same room see each other.
//   hands    a tavern hand (crew.hire, an id that is no roster character) hired by one player is not offered to another:
//            the hire goes out as world event 'handHired' { id, port } (the universe keeps it for a week of island days),
//            and the hands posted on the other players' boats (their state's crew) count too, so a late joiner knows.
//            sync.handTaken( id ) -> bool   (crew.hireables filters with it, see the report's patch)
//
//   const il = new InteriorLink( sync );  il.update( dt );  il.onEvent( kind, data );  il.taken (Set)  il.stats

import { CHARACTERS } from '../../game/Characters.js';
import { crewMembers } from './CrewLink.js';

export const INTERIOR_SYNC = {
	every: 0.2, // s between two looks at where the peers are
	pad: - 0.05, // m: inside the inner faces (Interiors.update's own margin)
};

export class InteriorLink {

	constructor( sync ) {

		this.sync = sync;
		this.taken = new Set();
		this.stats = { hidden: 0, handsOut: 0, handsIn: 0 };
		this._acc = 0;
		const f = sync.features;
		this._off = f && f.on ? f.on( 'crewHired', ( e ) => this._onHired( e ) ) : null;

	}

	get interiors() {

		const f = this.sync.features;
		return f && f.get ? f.get( 'interiors' ) : null;

	}

	// ------------------------------------------------------------------ rooms

	// the room ( Interiors list entry ) around a world point, or null
	roomAt( x, y, z ) {

		const it = this.interiors, R = it && it.rooms;
		if ( ! R || ! Array.isArray( R.list ) || typeof R.contains !== 'function' ) return null;
		for ( const room of R.list ) if ( room && ! room.destroyed && R.contains( room, x, y, z, INTERIOR_SYNC.pad ) ) return room;
		return null;

	}

	_place() {

		const rp = this.sync.app.remotePlayers;
		if ( ! rp || ! rp.peers ) return;
		const it = this.interiors;
		const mine = it ? it.inside || null : null;
		let hidden = 0;
		for ( const p of rp.peers.values() ) {

			const pos = p.hasPose && p.pose && p.pose.position;
			// (a guest seated on a boat, a player at a helm: never in a room)
			const room = pos && ! p.riding && ( p.pose.mode === 'walk' || p.pose.mode === 'seat' ) ? this.roomAt( pos.x, pos.y, pos.z ) : null;
			p.indoor = room ? room.id : null;
			p.hiddenIndoor = !! room && room !== mine;
			if ( p.hiddenIndoor ) hidden ++;

		}

		this.stats.hidden = hidden;

	}

	// ------------------------------------------------------------------ tavern hands

	_onHired( e ) {

		const id = e && typeof e.id === 'string' ? e.id : null;
		if ( ! id || CHARACTERS[ id ] ) return; // (a roster character is everybody's to post)
		const ns = this.sync;
		if ( ns.online && ns.net.sendEvent( 'handHired', { id, port: typeof e.port === 'string' ? e.port : null } ) ) this.stats.handsOut ++;

	}

	// NetSync._onEvent: another player's hire (or the universe's stored one)
	onEvent( kind, data ) {

		if ( kind !== 'handHired' || ! data || typeof data.id !== 'string' || data.id.length > 40 ) return;
		this.taken.add( data.id );
		this.stats.handsIn ++;

	}

	// a tavern hand signed on with another ship: hired by somebody (an event), or posted on somebody's boat now
	handTaken( id ) {

		if ( typeof id !== 'string' ) return false;
		if ( this.taken.has( id ) ) return true;
		const rp = this.sync.app.remotePlayers;
		if ( ! rp || ! rp.peers ) return false;
		for ( const p of rp.peers.values() ) {

			const list = p.extra && p.extra.crew;
			if ( list && crewMembers( list ).some( ( m ) => m.id === id ) ) return true;

		}

		return false;

	}

	// ------------------------------------------------------------------ frame

	clear() {

		const rp = this.sync.app.remotePlayers;
		if ( rp && rp.peers ) for ( const p of rp.peers.values() ) p.hiddenIndoor = false;

	}

	update( dt ) {

		const net = this.sync.net;
		if ( ! net || ! net.online ) return;
		this._acc += dt;
		if ( this._acc < INTERIOR_SYNC.every ) return;
		this._acc = 0;
		this._place();

	}

	dispose() {

		if ( this._off ) this._off();
		this._off = null;

	}

}
